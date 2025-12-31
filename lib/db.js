const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'subway-tracker.db'));
db.pragma('foreign_keys = ON');

// Initialize schema
function initSchema() {
  // Create users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      pin TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Check if visited_stations needs migration
  const tableInfo = db.prepare("PRAGMA table_info(visited_stations)").all();
  const hasUserId = tableInfo.some(col => col.name === 'user_id');

  if (!hasUserId) {
    console.log('Migrating visited_stations table...');
    
    // Get existing data
    const oldData = db.prepare('SELECT station_id, visited_at FROM visited_stations').all();
    
    // Create new table with user_id
    db.exec('DROP TABLE visited_stations');
    db.exec(`
      CREATE TABLE visited_stations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        station_id TEXT NOT NULL,
        visited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, station_id)
      )
    `);
    
    // Create kartikye user with PIN 4569
    const result = db.prepare('INSERT INTO users (username, pin) VALUES (?, ?)').run('kartikye', '4569');
    const kartikyeId = result.lastInsertRowid;
    console.log(`Created user kartikye with id ${kartikyeId}`);
    
    // Migrate old data to kartikye
    if (oldData.length > 0) {
      const insert = db.prepare('INSERT INTO visited_stations (user_id, station_id, visited_at) VALUES (?, ?, ?)');
      oldData.forEach(row => {
        insert.run(kartikyeId, row.station_id, row.visited_at || new Date().toISOString());
      });
      console.log(`Migrated ${oldData.length} visited stations to kartikye`);
    }
  }
}

initSchema();

module.exports = db;
