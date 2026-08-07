// Centralized Socket.IO access to avoid circular requires between server.js and routes/services.
let ioInstance = null;

// Called once from server.js after the Socket.IO server is created.
function init(io) {
  ioInstance = io;
}

// Broadcast an event to all connected clients.
function emit(event, payload) {
  if (ioInstance) {
    ioInstance.emit(event, payload);
  }
}

// Broadcast an event to a specific room.
function to(room, event, payload) {
  if (ioInstance) {
    ioInstance.to(room).emit(event, payload);
  }
}

// Raw access for handlers that need io directly (server.js connection wiring).
function get() {
  return ioInstance;
}

module.exports = { init, emit, to, get };
