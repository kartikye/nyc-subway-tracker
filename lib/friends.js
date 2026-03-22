const db = require('./db');

// Send a friend request
function sendFriendRequest(requesterId, addresseeId) {
  if (requesterId === addresseeId) {
    return { error: 'Cannot friend yourself' };
  }
  
  // Check if friendship already exists (in either direction)
  const existing = db.prepare(`
    SELECT * FROM friendships 
    WHERE (requester_id = ? AND addressee_id = ?) 
       OR (requester_id = ? AND addressee_id = ?)
  `).get(requesterId, addresseeId, addresseeId, requesterId);
  
  if (existing) {
    if (existing.status === 'accepted') {
      return { error: 'Already friends' };
    }
    if (existing.requester_id === requesterId) {
      return { error: 'Request already sent' };
    }
    // They sent us a request - auto-accept
    db.prepare('UPDATE friendships SET status = ? WHERE id = ?').run('accepted', existing.id);
    return { success: true, status: 'accepted' };
  }
  
  try {
    db.prepare('INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, ?)').run(
      requesterId, addresseeId, 'pending'
    );
    return { success: true, status: 'pending' };
  } catch (err) {
    return { error: 'Failed to send request' };
  }
}

// Accept a friend request
function acceptFriendRequest(friendshipId, userId) {
  const friendship = db.prepare('SELECT * FROM friendships WHERE id = ? AND addressee_id = ? AND status = ?').get(
    friendshipId, userId, 'pending'
  );
  
  if (!friendship) {
    return { error: 'Request not found' };
  }
  
  db.prepare('UPDATE friendships SET status = ? WHERE id = ?').run('accepted', friendshipId);
  return { success: true };
}

// Decline or remove a friend
function removeFriend(friendshipId, userId) {
  const friendship = db.prepare(`
    SELECT * FROM friendships 
    WHERE id = ? AND (requester_id = ? OR addressee_id = ?)
  `).get(friendshipId, userId, userId);
  
  if (!friendship) {
    return { error: 'Friendship not found' };
  }
  
  db.prepare('DELETE FROM friendships WHERE id = ?').run(friendshipId);
  return { success: true };
}

// Get all accepted friends for a user
function getFriends(userId) {
  return db.prepare(`
    SELECT 
      f.id as friendship_id,
      CASE WHEN f.requester_id = ? THEN u2.id ELSE u1.id END as id,
      CASE WHEN f.requester_id = ? THEN u2.username ELSE u1.username END as username,
      f.created_at
    FROM friendships f
    JOIN users u1 ON f.requester_id = u1.id
    JOIN users u2 ON f.addressee_id = u2.id
    WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status = 'accepted'
  `).all(userId, userId, userId, userId);
}

// Get pending friend requests (where user is the addressee)
function getPendingRequests(userId) {
  return db.prepare(`
    SELECT f.id as friendship_id, u.id, u.username, f.created_at
    FROM friendships f
    JOIN users u ON f.requester_id = u.id
    WHERE f.addressee_id = ? AND f.status = 'pending'
  `).all(userId);
}

// Get outgoing requests (where user is the requester)
function getOutgoingRequests(userId) {
  return db.prepare(`
    SELECT f.id as friendship_id, u.id, u.username, f.created_at
    FROM friendships f
    JOIN users u ON f.addressee_id = u.id
    WHERE f.requester_id = ? AND f.status = 'pending'
  `).all(userId);
}

// Check if two users are friends
function areFriends(userId1, userId2) {
  const friendship = db.prepare(`
    SELECT * FROM friendships 
    WHERE ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
    AND status = 'accepted'
  `).get(userId1, userId2, userId2, userId1);
  
  return !!friendship;
}

// Get a friend's visited stations (only if friends)
function getFriendVisited(userId, friendId) {
  if (!areFriends(userId, friendId)) {
    return null;
  }
  
  return db.prepare('SELECT station_id FROM visited_stations WHERE user_id = ?').all(friendId)
    .map(row => row.station_id);
}

// Get stations neither user has visited
function getUnvisitedTogether(userId, friendId) {
  if (!areFriends(userId, friendId)) {
    return null;
  }
  
  // Get all stations visited by either user
  const userVisited = new Set(
    db.prepare('SELECT station_id FROM visited_stations WHERE user_id = ?').all(userId)
      .map(row => row.station_id)
  );
  
  const friendVisited = new Set(
    db.prepare('SELECT station_id FROM visited_stations WHERE user_id = ?').all(friendId)
      .map(row => row.station_id)
  );
  
  // Return stations visited by neither (will be computed client-side against full station list)
  return {
    userVisited: Array.from(userVisited),
    friendVisited: Array.from(friendVisited)
  };
}

module.exports = {
  sendFriendRequest,
  acceptFriendRequest,
  removeFriend,
  getFriends,
  getPendingRequests,
  getOutgoingRequests,
  areFriends,
  getFriendVisited,
  getUnvisitedTogether
};
