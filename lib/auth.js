const db = require('./db');

function generateSessionId() {
  const bytes = new Uint8Array(24);
  for (let i = 0; i < 24; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Session duration: 30 days
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

function createUser(username, pin) {
  try {
    const result = db.prepare('INSERT INTO users (username, pin) VALUES (?, ?)').run(username.toLowerCase(), pin);
    return { id: result.lastInsertRowid, username: username.toLowerCase() };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return null; // Username taken
    }
    throw err;
  }
}

function verifyUser(username, pin) {
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND pin = ?').get(username.toLowerCase(), pin);
  return user || null;
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
}

function createSession(userId) {
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(sessionId, userId, expiresAt);
  return sessionId;
}

function getUserFromSession(sessionId) {
  if (!sessionId) return null;
  
  const row = db.prepare(`
    SELECT u.id, u.username 
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > datetime('now')
  `).get(sessionId);
  
  return row || null;
}

function deleteSession(sessionId) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

// Middleware
function authMiddleware(req, res, next) {
  const sessionId = req.cookies?.session_id;
  req.user = getUserFromSession(sessionId);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

module.exports = {
  createUser,
  verifyUser,
  getUserByUsername,
  createSession,
  getUserFromSession,
  deleteSession,
  authMiddleware,
  requireAuth,
  SESSION_MAX_AGE
};
