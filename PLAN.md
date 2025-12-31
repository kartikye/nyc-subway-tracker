# Multi-User Support Implementation Plan
**NYC Subway Tracker - Magic Link Authentication**

## Overview
This plan outlines the implementation of multi-user support using passwordless magic link authentication. Users will receive an email with a login link, click it, and be automatically logged in with their session stored in a secure cookie.

---

## 1. Database Schema Changes

### New Tables

#### `users` table
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME
);
```

#### `magic_links` table
```sql
CREATE TABLE magic_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_magic_links_token ON magic_links(token);
CREATE INDEX idx_magic_links_expires ON magic_links(expires_at);
```

#### `sessions` table
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,          -- session ID (UUID)
  user_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
```

#### Updated `visited_stations` table
```sql
-- Add user_id column and update primary key
ALTER TABLE visited_stations ADD COLUMN user_id INTEGER;

-- Migration: Set all existing records to NULL or a default "anonymous" user
-- Then make it NOT NULL after migration

-- New schema (recreate table):
CREATE TABLE visited_stations_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  station_id TEXT NOT NULL,
  visited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, station_id)
);

CREATE INDEX idx_visited_user ON visited_stations_new(user_id);
CREATE INDEX idx_visited_station ON visited_stations_new(station_id);
```

---

## 2. New Dependencies

Add to `package.json`:

```json
{
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "express": "^4.18.2",
    "cookie-parser": "^1.4.6",        // Parse cookies
    "express-session": "^1.17.3",      // Session management (optional, can use custom)
    "nanoid": "^3.3.7",                // Generate secure tokens
    "nodemailer": "^6.9.7",            // Send emails
    "dotenv": "^16.3.1"                // Environment variables
  }
}
```

**Note**: For production, consider using a transactional email service like:
- SendGrid
- Mailgun
- AWS SES
- Resend (modern, developer-friendly)

---

## 3. Environment Variables

Create `.env` file:

```bash
# Server
PORT=3001
NODE_ENV=development

# Session
SESSION_SECRET=<generate-random-secret-here>
SESSION_MAX_AGE=2592000000  # 30 days in milliseconds

# Magic Link
MAGIC_LINK_EXPIRY=900000     # 15 minutes in milliseconds
BASE_URL=http://localhost:3001

# Email (using Gmail SMTP for development)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-specific-password
EMAIL_FROM=NYC Subway Tracker <your-email@gmail.com>

# Alternative: Use a service like Resend
# RESEND_API_KEY=re_xxxxxxxxxxxxx
```

Add `.env` to `.gitignore`.

---

## 4. New Files to Create

### `/lib/db.js`
Database initialization and schema setup. Centralizes database access.

```javascript
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'subway-tracker.db'));

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize schema
function initSchema() {
  // Create users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    )
  `);

  // Create magic_links table
  db.exec(`
    CREATE TABLE IF NOT EXISTS magic_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_magic_links_token ON magic_links(token)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_magic_links_expires ON magic_links(expires_at)');

  // Create sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)');

  // Update visited_stations table (migration logic needed)
  // Check if user_id column exists
  const hasUserId = db.prepare(`
    SELECT COUNT(*) as count 
    FROM pragma_table_info('visited_stations') 
    WHERE name='user_id'
  `).get().count > 0;

  if (!hasUserId) {
    // Migration: recreate table with user_id
    db.exec(`
      CREATE TABLE visited_stations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        station_id TEXT NOT NULL,
        visited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, station_id)
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_visited_user ON visited_stations_new(user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_visited_station ON visited_stations_new(station_id)');
    
    // Drop old table
    db.exec('DROP TABLE IF EXISTS visited_stations');
    db.exec('ALTER TABLE visited_stations_new RENAME TO visited_stations');
  }
}

initSchema();

module.exports = db;
```

### `/lib/email.js`
Email sending functionality for magic links.

```javascript
const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendMagicLink(email, magicLink) {
  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: email,
    subject: 'Your NYC Subway Tracker Login Link',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>NYC Subway Tracker Login</h2>
        <p>Click the link below to log in to your account:</p>
        <p>
          <a href="${magicLink}" 
             style="background-color: #2563eb; color: white; padding: 12px 24px; 
                    text-decoration: none; border-radius: 6px; display: inline-block;">
            Log In to NYC Subway Tracker
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">
          This link will expire in 15 minutes. If you didn't request this, you can safely ignore this email.
        </p>
        <p style="color: #999; font-size: 12px; margin-top: 30px;">
          Or copy and paste this link: ${magicLink}
        </p>
      </div>
    `,
    text: `
      NYC Subway Tracker Login
      
      Click the link below to log in:
      ${magicLink}
      
      This link will expire in 15 minutes.
    `,
  };

  await transporter.sendMail(mailOptions);
}

module.exports = { sendMagicLink };
```

### `/lib/auth.js`
Authentication helpers and middleware.

```javascript
const { nanoid } = require('nanoid');
const db = require('./db');

// Session duration: 30 days
const SESSION_MAX_AGE = parseInt(process.env.SESSION_MAX_AGE) || 30 * 24 * 60 * 60 * 1000;
const MAGIC_LINK_EXPIRY = parseInt(process.env.MAGIC_LINK_EXPIRY) || 15 * 60 * 1000;

/**
 * Find or create user by email
 */
function findOrCreateUser(email) {
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  
  if (!user) {
    const result = db.prepare('INSERT INTO users (email) VALUES (?)').run(email.toLowerCase());
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  }
  
  return user;
}

/**
 * Create a magic link token for a user
 */
function createMagicLink(userId) {
  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY).toISOString();
  
  db.prepare(`
    INSERT INTO magic_links (user_id, token, expires_at)
    VALUES (?, ?, ?)
  `).run(userId, token, expiresAt);
  
  return token;
}

/**
 * Verify and consume a magic link token
 */
function verifyMagicLink(token) {
  const link = db.prepare(`
    SELECT * FROM magic_links 
    WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')
  `).get(token);
  
  if (!link) return null;
  
  // Mark as used
  db.prepare('UPDATE magic_links SET used_at = datetime("now") WHERE id = ?').run(link.id);
  
  // Update last login
  db.prepare('UPDATE users SET last_login = datetime("now") WHERE id = ?').run(link.user_id);
  
  return link.user_id;
}

/**
 * Create a session for a user
 */
function createSession(userId) {
  const sessionId = nanoid(32);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE).toISOString();
  
  db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(sessionId, userId, expiresAt);
  
  return sessionId;
}

/**
 * Get user from session ID
 */
function getUserFromSession(sessionId) {
  if (!sessionId) return null;
  
  const session = db.prepare(`
    SELECT s.*, u.email 
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > datetime('now')
  `).get(sessionId);
  
  if (!session) return null;
  
  // Update last activity
  db.prepare('UPDATE sessions SET last_activity = datetime("now") WHERE id = ?').run(sessionId);
  
  return { id: session.user_id, email: session.email };
}

/**
 * Delete a session (logout)
 */
function deleteSession(sessionId) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

/**
 * Cleanup expired sessions and magic links
 */
function cleanupExpired() {
  db.prepare('DELETE FROM sessions WHERE expires_at < datetime("now")').run();
  db.prepare('DELETE FROM magic_links WHERE expires_at < datetime("now")').run();
}

/**
 * Middleware to require authentication
 */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

// Run cleanup every hour
setInterval(cleanupExpired, 60 * 60 * 1000);

module.exports = {
  findOrCreateUser,
  createMagicLink,
  verifyMagicLink,
  createSession,
  getUserFromSession,
  deleteSession,
  requireAuth,
};
```

### `/middleware/auth.js`
Express middleware for authentication.

```javascript
const { getUserFromSession } = require('../lib/auth');

function authMiddleware(req, res, next) {
  const sessionId = req.cookies.session_id;
  req.user = getUserFromSession(sessionId);
  next();
}

module.exports = authMiddleware;
```

### `/routes/auth.js`
Authentication routes.

```javascript
const express = require('express');
const { findOrCreateUser, createMagicLink, verifyMagicLink, createSession, deleteSession } = require('../lib/auth');
const { sendMagicLink } = require('../lib/email');

const router = express.Router();

/**
 * POST /auth/request-login
 * Request a magic link
 */
router.post('/request-login', async (req, res) => {
  const { email } = req.body;
  
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  
  try {
    const user = findOrCreateUser(email);
    const token = createMagicLink(user.id);
    const magicLink = `${process.env.BASE_URL}/auth/verify?token=${token}`;
    
    await sendMagicLink(email, magicLink);
    
    res.json({ success: true, message: 'Check your email for the login link' });
  } catch (error) {
    console.error('Error sending magic link:', error);
    res.status(500).json({ error: 'Failed to send login link' });
  }
});

/**
 * GET /auth/verify?token=xxx
 * Verify magic link and create session
 */
router.get('/verify', (req, res) => {
  const { token } = req.query;
  
  if (!token) {
    return res.status(400).send('Invalid or missing token');
  }
  
  const userId = verifyMagicLink(token);
  
  if (!userId) {
    return res.status(400).send('Invalid or expired login link');
  }
  
  const sessionId = createSession(userId);
  
  // Set secure cookie
  res.cookie('session_id', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: parseInt(process.env.SESSION_MAX_AGE),
  });
  
  res.redirect('/');
});

/**
 * POST /auth/logout
 * Logout user
 */
router.post('/logout', (req, res) => {
  const sessionId = req.cookies.session_id;
  if (sessionId) {
    deleteSession(sessionId);
  }
  res.clearCookie('session_id');
  res.json({ success: true });
});

/**
 * GET /auth/me
 * Get current user
 */
router.get('/me', (req, res) => {
  if (req.user) {
    res.json({ user: req.user });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

module.exports = router;
```

---

## 5. Modified Files

### `server.js`
Update to use new authentication system.

**Changes:**
1. Add `require('dotenv').config()` at the top
2. Add `cookieParser` middleware
3. Add authentication middleware
4. Import and use auth routes
5. Import centralized database from `/lib/db.js`
6. Update all `/api/visited` endpoints to filter by `req.user.id`
7. Add authentication requirement to all API endpoints

**Key modifications:**
```javascript
// Add at top
require('dotenv').config();
const cookieParser = require('cookie-parser');
const db = require('./lib/db');
const authMiddleware = require('./middleware/auth');
const authRoutes = require('./routes/auth');

// Add middleware
app.use(cookieParser());
app.use(authMiddleware);

// Mount auth routes
app.use('/auth', authRoutes);

// Update visited stations endpoints
const { requireAuth } = require('./lib/auth');

// All /api/visited endpoints need requireAuth middleware
// Update queries to include user_id filter

// Example:
app.get('/api/visited', requireAuth, (req, res) => {
  const stmt = db.prepare('SELECT station_id FROM visited_stations WHERE user_id = ? ORDER BY visited_at');
  const rows = stmt.all(req.user.id);
  // ...
});
```

### `index.html`
Add login UI.

**Changes:**
1. Add login modal/form that appears when user is not authenticated
2. Add logout button in header when authenticated
3. Add user email display in header
4. Show loading state while checking auth

**New elements:**
```html
<!-- Login Modal (show when not authenticated) -->
<div id="login-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
  <div class="bg-white p-8 rounded-lg shadow-xl max-w-md w-full mx-4">
    <h2 class="text-2xl font-bold mb-4">Welcome to NYC Subway Tracker</h2>
    <p class="text-gray-600 mb-6">Enter your email to get started. We'll send you a magic link to log in.</p>
    <form id="login-form">
      <input 
        type="email" 
        id="login-email" 
        placeholder="your@email.com"
        class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
        required
      >
      <button 
        type="submit"
        class="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
      >
        Send Magic Link
      </button>
    </form>
    <p id="login-message" class="mt-4 text-sm text-gray-600 hidden"></p>
  </div>
</div>

<!-- User info in header (update existing header) -->
<div class="flex items-center justify-between mb-2">
  <div>
    <h1 class="text-3xl font-bold text-gray-800">NYC Subway Tracker</h1>
    <p class="text-gray-600 text-sm">Catch 'Em All! 🚇</p>
  </div>
  <div id="user-info" class="hidden text-right">
    <p class="text-sm text-gray-600" id="user-email"></p>
    <button id="logout-btn" class="text-xs text-red-600 hover:text-red-800 underline">
      Logout
    </button>
  </div>
</div>
```

### `app.js`
Update to handle authentication.

**Changes:**
1. Check authentication status on load
2. Show/hide login modal based on auth state
3. Handle login form submission
4. Handle logout
5. Only load station data if authenticated
6. Show loading state

**New code at start of `SubwayTracker` class:**
```javascript
async init() {
  // Check if user is authenticated
  const isAuthenticated = await this.checkAuth();
  
  if (!isAuthenticated) {
    this.showLoginModal();
    return;
  }
  
  // Continue with normal initialization
  await this.loadVisitedStations();
  this.initMap();
  // ...
}

async checkAuth() {
  try {
    const response = await fetch('/auth/me');
    if (response.ok) {
      const data = await response.json();
      this.user = data.user;
      this.showUserInfo();
      return true;
    }
    return false;
  } catch (error) {
    console.error('Auth check failed:', error);
    return false;
  }
}

showLoginModal() {
  const modal = document.getElementById('login-modal');
  modal.classList.remove('hidden');
  
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await this.handleLogin();
  });
}

async handleLogin() {
  const email = document.getElementById('login-email').value;
  const message = document.getElementById('login-message');
  
  try {
    const response = await fetch('/auth/request-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    
    const data = await response.json();
    
    if (response.ok) {
      message.textContent = '✓ Check your email for the login link!';
      message.classList.remove('hidden', 'text-red-600');
      message.classList.add('text-green-600');
    } else {
      message.textContent = data.error || 'Failed to send login link';
      message.classList.remove('hidden', 'text-green-600');
      message.classList.add('text-red-600');
    }
  } catch (error) {
    message.textContent = 'Network error. Please try again.';
    message.classList.remove('hidden', 'text-green-600');
    message.classList.add('text-red-600');
  }
}

showUserInfo() {
  const userInfo = document.getElementById('user-info');
  const userEmail = document.getElementById('user-email');
  userEmail.textContent = this.user.email;
  userInfo.classList.remove('hidden');
  
  document.getElementById('logout-btn').addEventListener('click', () => this.handleLogout());
}

async handleLogout() {
  try {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.reload();
  } catch (error) {
    console.error('Logout failed:', error);
  }
}
```

### `package.json`
Add new dependencies (see section 2 above).

### `.gitignore`
Add:
```
.env
*.db
*.db-shm
*.db-wal
node_modules/
```

---

## 6. Authentication Flow

### Login Flow
1. User visits site → `app.js` checks `/auth/me`
2. If not authenticated → show login modal
3. User enters email → POST to `/auth/request-login`
4. Server creates user (if new), generates magic link token, sends email
5. User clicks link in email → GET `/auth/verify?token=xxx`
6. Server verifies token, creates session, sets cookie
7. Redirects to `/` → user is logged in
8. `app.js` detects authentication, loads user's data

### Session Management
- Session ID stored in httpOnly cookie
- Cookie expires in 30 days
- Session validated on each request via middleware
- Expired sessions cleaned up hourly

### Logout Flow
1. User clicks logout → POST to `/auth/logout`
2. Server deletes session, clears cookie
3. Page reloads → login modal appears

---

## 7. Migration Strategy

### For Existing Data
Since there's already a `visited_stations` table with data:

**Option 1: Fresh Start (Recommended for MVP)**
- Drop old `visited_stations` table
- Create new schema with `user_id`
- No migration of old data

**Option 2: Migrate to Default User**
1. Create a "legacy" user account
2. Assign all existing visited stations to that user
3. Send magic link to legacy user
4. They can claim their progress

**Implementation (Option 2):**
```javascript
// In lib/db.js after schema creation
function migrateOldData() {
  const oldData = db.prepare('SELECT * FROM visited_stations').all();
  
  if (oldData.length > 0 && !oldData[0].user_id) {
    // Create legacy user
    const result = db.prepare('INSERT INTO users (email) VALUES (?)').run('legacy@subway-tracker.local');
    const legacyUserId = result.lastInsertRowid;
    
    // Migrate data
    const insert = db.prepare('INSERT INTO visited_stations_new (user_id, station_id, visited_at) VALUES (?, ?, ?)');
    oldData.forEach(row => {
      insert.run(legacyUserId, row.station_id, row.visited_at);
    });
  }
}
```

---

## 8. Security Considerations

### Implemented
- ✓ httpOnly cookies (prevents XSS)
- ✓ Secure flag in production (HTTPS only)
- ✓ SameSite=lax (CSRF protection)
- ✓ Magic links expire in 15 minutes
- ✓ Tokens are single-use
- ✓ Sessions expire after 30 days
- ✓ Foreign key constraints
- ✓ SQL injection protection (prepared statements)

### Additional Recommendations
- Rate limit `/auth/request-login` (max 3 requests per hour per email)
- Add CORS configuration if needed
- Use environment-specific BASE_URL
- Consider adding email verification for new accounts
- Add logging for security events
- Consider adding 2FA in future

---

## 9. Testing Plan

### Manual Testing
1. **First-time user flow**
   - Enter email → receive magic link → click → logged in
   - Mark stations → data persists
2. **Returning user flow**
   - Request new login link → click → see previous progress
3. **Multi-user test**
   - Login as user A → mark stations
   - Logout → login as user B → should see empty list
   - Login back as user A → should see original progress
4. **Session expiry**
   - Manually delete session from DB → next request should fail
5. **Magic link expiry**
   - Wait 15 minutes → link should not work
6. **Magic link reuse**
   - Use same link twice → second use should fail

### Edge Cases
- Invalid email format
- Expired magic link
- Already-used magic link
- Deleted user account
- Concurrent sessions (same user, multiple devices)

---

## 10. Deployment Checklist

### Environment Setup
- [ ] Set all environment variables in production
- [ ] Use production email service (not Gmail SMTP)
- [ ] Set `NODE_ENV=production`
- [ ] Set `BASE_URL` to production domain
- [ ] Generate strong `SESSION_SECRET`
- [ ] Enable HTTPS (required for secure cookies)

### Database
- [ ] Backup existing database
- [ ] Run migration script
- [ ] Verify schema with `.schema` in sqlite3
- [ ] Set up automated backups

### Security
- [ ] Enable rate limiting on auth endpoints
- [ ] Set up monitoring/logging
- [ ] Test HTTPS configuration
- [ ] Verify cookie security flags
- [ ] Review CORS settings

---

## 11. Future Enhancements

### Phase 2 (Optional)
- Remember me checkbox (longer session)
- Delete account functionality
- Export data as CSV/JSON
- Share progress via public URL
- Leaderboard (most stations visited)
- Email notifications (weekly progress)
- Social login (Google, GitHub)
- Password option (in addition to magic link)

### Phase 3 (Optional)
- Multi-device sync status indicator
- Profile customization
- Station notes/photos
- Achievement badges
- Friends/social features

---

## 12. Estimated Implementation Time

- **Database schema & migration**: 1-2 hours
- **Email setup**: 1 hour
- **Auth backend (lib/auth.js, routes/auth.js)**: 2-3 hours
- **Server.js updates**: 1 hour
- **Frontend UI (login modal, user info)**: 2-3 hours
- **Frontend auth logic**: 1-2 hours
- **Testing**: 2-3 hours
- **Documentation & deployment**: 1 hour

**Total**: 11-16 hours (1-2 days of focused work)

---

## 13. Summary

This plan provides a complete, production-ready multi-user authentication system using magic links. It's:

- **Simple**: No password management, minimal UI changes
- **Secure**: httpOnly cookies, token expiry, single-use links
- **Scalable**: SQLite can handle thousands of users
- **User-friendly**: One-click email login
- **Maintainable**: Clean separation of concerns, well-documented

The implementation prioritizes security and simplicity while providing a smooth user experience. All existing functionality is preserved, with the addition of per-user data isolation.
