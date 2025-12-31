const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const db = require('./lib/db');
const { createUser, verifyUser, getUserByUsername, createSession, deleteSession, authMiddleware, requireAuth, SESSION_MAX_AGE } = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(authMiddleware);
app.use(express.static(__dirname));

// ============ AUTH ROUTES ============

// Check current user
app.get('/auth/me', (req, res) => {
  if (req.user) {
    res.json({ user: { id: req.user.id, username: req.user.username } });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// Register new user
app.post('/auth/register', (req, res) => {
  const { username, pin } = req.body;
  
  if (!username || !pin) {
    return res.status(400).json({ error: 'Username and PIN required' });
  }
  
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: 'Username must be 3-20 characters' });
  }
  
  if (!/^\d{4,6}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN must be 4-6 digits' });
  }
  
  const user = createUser(username, pin);
  if (!user) {
    return res.status(400).json({ error: 'Username already taken' });
  }
  
  const sessionId = createSession(user.id);
  res.cookie('session_id', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE
  });
  
  res.json({ success: true, user: { id: user.id, username: user.username } });
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
  
  res.json({ success: true, user: { id: user.id, username: user.username } });
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
