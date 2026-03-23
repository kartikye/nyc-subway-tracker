const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const db = require('./lib/db');
const { createUser, verifyUser, getUserByUsername, getUserByEmail, getUserById, updateEmail, createSession, deleteSession, authMiddleware, requireAuth, SESSION_MAX_AGE } = require('./lib/auth');
const { sendFriendRequest, acceptFriendRequest, removeFriend, getFriends, getPendingRequests, getOutgoingRequests, getFriendVisited, getUnvisitedTogether } = require('./lib/friends');
const { STATION_COMPLEXES, getComplexId } = require('./stations.js');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(authMiddleware);

// No-cache headers for static files (prevents mobile caching issues)
app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.html') || req.path === '/') {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

app.use(express.static(__dirname));

// ============ REDIRECTS ============

// Redirect /subscribe to /unsub/subscribe
app.get('/subscribe', (req, res) => {
  res.redirect(301, '/unsub/subscribe');
});

// ============ AUTH ROUTES ============

// Check current user
app.get('/auth/me', (req, res) => {
  if (req.user) {
    res.json({ user: { id: req.user.id, username: req.user.username, email: req.user.email } });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// Register new user
app.post('/auth/register', (req, res) => {
  const { username, pin, email } = req.body;
  
  if (!username || !pin || !email) {
    return res.status(400).json({ error: 'Username, PIN, and email required' });
  }
  
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: 'Username must be 3-20 characters' });
  }
  
  if (!/^\d{4,6}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN must be 4-6 digits' });
  }
  
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  
  const user = createUser(username, pin, email);
  if (!user) {
    return res.status(400).json({ error: 'Username or email already taken' });
  }
  
  const sessionId = createSession(user.id);
  res.cookie('session_id', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE
  });
  
  res.json({ success: true, user: { id: user.id, username: user.username, email: user.email } });
});

// Login
app.post('/auth/login', (req, res) => {
  const { username, pin } = req.body;
  
  if (!username || !pin) {
    return res.status(400).json({ error: 'Username and PIN required' });
  }
  
  const user = verifyUser(username, pin);
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or PIN' });
  }
  
  const sessionId = createSession(user.id);
  res.cookie('session_id', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE
  });
  
  res.json({ success: true, user: { id: user.id, username: user.username, email: user.email } });
});

// Update email
app.put('/auth/email', requireAuth, (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }
  
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  
  const success = updateEmail(req.user.id, email);
  if (!success) {
    return res.status(400).json({ error: 'Email already taken' });
  }
  
  res.json({ success: true, email: email.toLowerCase() });
});

// Check if username exists
app.get('/auth/check/:username', (req, res) => {
  const user = getUserByUsername(req.params.username);
  res.json({ exists: !!user });
});

// Logout
app.post('/auth/logout', (req, res) => {
  const sessionId = req.cookies?.session_id;
  if (sessionId) {
    deleteSession(sessionId);
  }
  res.clearCookie('session_id');
  res.json({ success: true });
});

// ============ FRIENDS ROUTES ============

// Get friends list
app.get('/api/friends', requireAuth, (req, res) => {
  try {
    const friends = getFriends(req.user.id);
    res.json(friends);
  } catch (error) {
    console.error('Error fetching friends:', error);
    res.status(500).json({ error: 'Failed to fetch friends' });
  }
});

// Get pending friend requests
app.get('/api/friends/requests', requireAuth, (req, res) => {
  try {
    const incoming = getPendingRequests(req.user.id);
    const outgoing = getOutgoingRequests(req.user.id);
    res.json({ incoming, outgoing });
  } catch (error) {
    console.error('Error fetching friend requests:', error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// Send friend request (by username or email)
app.post('/api/friends/request', requireAuth, (req, res) => {
  const { identifier } = req.body; // can be username or email
  
  if (!identifier) {
    return res.status(400).json({ error: 'Username or email required' });
  }
  
  // Try to find user by email first, then username
  let targetUser = null;
  if (identifier.includes('@')) {
    targetUser = getUserByEmail(identifier);
  }
  if (!targetUser) {
    targetUser = getUserByUsername(identifier);
  }
  
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const result = sendFriendRequest(req.user.id, targetUser.id);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  
  res.json({ success: true, status: result.status, username: targetUser.username });
});

// Accept friend request
app.post('/api/friends/:id/accept', requireAuth, (req, res) => {
  const friendshipId = parseInt(req.params.id);
  
  const result = acceptFriendRequest(friendshipId, req.user.id);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  
  res.json({ success: true });
});

// Remove friend or decline request
app.delete('/api/friends/:id', requireAuth, (req, res) => {
  const friendshipId = parseInt(req.params.id);
  
  const result = removeFriend(friendshipId, req.user.id);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  
  res.json({ success: true });
});

// Get friend's visited stations
app.get('/api/friends/:id/visited', requireAuth, (req, res) => {
  const friendId = parseInt(req.params.id);
  
  const visited = getFriendVisited(req.user.id, friendId);
  if (visited === null) {
    return res.status(403).json({ error: 'Not friends with this user' });
  }
  
  res.json(visited);
});

// Get stations to visit together (neither has visited)
app.get('/api/friends/:id/together', requireAuth, (req, res) => {
  const friendId = parseInt(req.params.id);
  
  const data = getUnvisitedTogether(req.user.id, friendId);
  if (data === null) {
    return res.status(403).json({ error: 'Not friends with this user' });
  }
  
  res.json(data);
});

// ============ API ROUTES ============

// GET /api/visited - returns array of visited station IDs
app.get('/api/visited', requireAuth, (req, res) => {
  try {
    const stmt = db.prepare('SELECT station_id FROM visited_stations WHERE user_id = ? ORDER BY visited_at');
    const rows = stmt.all(req.user.id);
    const stationIds = rows.map(row => row.station_id);
    res.json(stationIds);
  } catch (error) {
    console.error('Error fetching visited stations:', error);
    res.status(500).json({ error: 'Failed to fetch visited stations' });
  }
});

// POST /api/visited/:stationId - mark station as visited
app.post('/api/visited/:stationId', requireAuth, (req, res) => {
  const { stationId } = req.params;
  
  try {
    const stmt = db.prepare('INSERT OR REPLACE INTO visited_stations (user_id, station_id) VALUES (?, ?)');
    stmt.run(req.user.id, stationId);
    res.json({ success: true, stationId });
  } catch (error) {
    console.error('Error marking station as visited:', error);
    res.status(500).json({ error: 'Failed to mark station as visited' });
  }
});

// DELETE /api/visited/:stationId - unmark station
app.delete('/api/visited/:stationId', requireAuth, (req, res) => {
  const { stationId } = req.params;
  
  try {
    const stmt = db.prepare('DELETE FROM visited_stations WHERE user_id = ? AND station_id = ?');
    const result = stmt.run(req.user.id, stationId);
    res.json({ success: true, stationId, deleted: result.changes > 0 });
  } catch (error) {
    console.error('Error unmarking station:', error);
    res.status(500).json({ error: 'Failed to unmark station' });
  }
});

// DELETE /api/visited - clear all visited stations for user
app.delete('/api/visited', requireAuth, (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM visited_stations WHERE user_id = ?');
    const result = stmt.run(req.user.id);
    res.json({ success: true, deletedCount: result.changes });
  } catch (error) {
    console.error('Error clearing visited stations:', error);
    res.status(500).json({ error: 'Failed to clear visited stations' });
  }
});

// GET /api/leaderboard - get top users by visited stations (counting by complex)
app.get('/api/leaderboard', requireAuth, (req, res) => {
  try {
    const users = db.prepare('SELECT id, username FROM users').all();
    
    const leaderboard = users.map(user => {
      const stations = db.prepare('SELECT station_id FROM visited_stations WHERE user_id = ?').all(user.id);
      
      // Count unique complexes
      const uniqueComplexes = new Set(
        stations.map(s => getComplexId(s.station_id))
      );
      
      return {
        username: user.username,
        station_count: uniqueComplexes.size
      };
    });
    
    // Sort by station count descending
    leaderboard.sort((a, b) => b.station_count - a.station_count);
    
    res.json(leaderboard.slice(0, 50));
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Subway Tracker server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});
