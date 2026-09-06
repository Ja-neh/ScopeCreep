// PartyKit Edge Server for ScopeCreep Multiplayer
export default class ScopeCreepServer {
  constructor(room) {
    this.room = room;
    this.players = new Map();
  }

  onConnect(conn, ctx) {
    console.log(`Player connected: ${conn.id} in room ${this.room.id}`);
  }

  onMessage(message, sender) {
    // Message dispatch handler
  }

  onClose(conn) {
    console.log(`Player disconnected: ${conn.id}`);
    this.players.delete(conn.id);
  }
}
