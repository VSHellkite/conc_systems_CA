'use strict';

const { randomUUID } = require('node:crypto');
const { Player } = require('./Player');

const LOBBY_ROOM = 'lobby';
const matchRoom = (matchId) => `match:${matchId}`;

class LobbyManager {
  constructor(io) {
    this.io = io;
    this.waitingPlayers = [];
    this.matches = new Map();
    this.userMatchIndex = new Map();
  }

  getSocket(socketId) {
    return this.io.sockets.sockets.get(socketId);
  }

  joinLobby(user, socketId) {
    if (this.userMatchIndex.has(user.userId)) return;

    const waitingPlayer = this.waitingPlayers.find((player) => player.userId === user.userId);
    if (waitingPlayer) {
      waitingPlayer.socketId = socketId;
    } else {
      this.waitingPlayers.push({ ...user, socketId });
    }

    this.broadcastLobby();

    if (this.waitingPlayers.length === 4) {
      this.startMatch(user.userId);
    }
  }

  leaveLobby(userId) {
    const previousLength = this.waitingPlayers.length;
    this.waitingPlayers = this.waitingPlayers.filter((player) => player.userId !== userId);

    if (this.waitingPlayers.length !== previousLength) {
      this.broadcastLobby();
    }
  }

  getLobbyState() {
    return {
      players: this.waitingPlayers.map((player) => ({
        userId: player.userId,
        username: player.username,
        gamesWon: player.gamesWon,
        gamesLost: player.gamesLost,
      })),
    };
  }

  broadcastLobby() {
    this.io.to(LOBBY_ROOM).emit('lobby:state', this.getLobbyState());
  }

  startMatch(requestingUserId) {
    if (!this.waitingPlayers.some((player) => player.userId === requestingUserId)) {
      throw new Error('You are not waiting in the lobby.');
    }
    if (this.waitingPlayers.length < 2) {
      throw new Error('At least two players are required to start a match.');
    }

    const selectedUsers = this.waitingPlayers.splice(0, 4);
    const match = {
      id: randomUUID(),
      players: selectedUsers.map((user, index) => {
        const player = new Player(user, index + 1);
        player.socketId = user.socketId;
        player.gamesWon = user.gamesWon;
        player.gamesLost = user.gamesLost;
        player.connected = true;
        return player;
      }),
    };

    this.matches.set(match.id, match);

    for (const player of match.players) {
      this.userMatchIndex.set(player.userId, match.id);
      const socket = this.getSocket(player.socketId);

      if (socket) {
        socket.leave(LOBBY_ROOM);
        socket.join(matchRoom(match.id));
      }
    }

    this.io.to(matchRoom(match.id)).emit('match:started', this.getMatchState(match));
    this.broadcastLobby();
    return match;
  }

  getMatchState(match) {
    return {
      id: match.id,
      players: match.players.map((player) => ({
        userId: player.userId,
        username: player.username,
        number: player.number,
        edge: player.edge,
        colorName: player.colorName,
        color: player.color,
        gamesWon: player.gamesWon,
        gamesLost: player.gamesLost,
        connected: player.connected,
      })),
    };
  }

  reconnect(userId, socketId) {
    const matchId = this.userMatchIndex.get(userId);
    const match = matchId ? this.matches.get(matchId) : null;
    if (!match) return null;

    const player = match.players.find((candidate) => candidate.userId === userId);
    player.socketId = socketId;
    player.connected = true;

    const socket = this.getSocket(socketId);
    if (socket) socket.join(matchRoom(match.id));

    this.io.to(matchRoom(match.id)).emit('match:state', this.getMatchState(match));
    return match;
  }

  closeMatch(userId) {
    const matchId = this.userMatchIndex.get(userId);
    const match = matchId ? this.matches.get(matchId) : null;
    if (!match) return;

    this.io.to(matchRoom(match.id)).emit('match:closed');

    for (const player of match.players) {
      this.userMatchIndex.delete(player.userId);
      const socket = this.getSocket(player.socketId);
      if (socket) socket.leave(matchRoom(match.id));
    }

    this.matches.delete(match.id);
  }

  disconnect(userId) {
    this.leaveLobby(userId);

    const matchId = this.userMatchIndex.get(userId);
    const match = matchId ? this.matches.get(matchId) : null;
    if (!match) return;

    const player = match.players.find((candidate) => candidate.userId === userId);
    player.connected = false;
    this.io.to(matchRoom(match.id)).emit('match:state', this.getMatchState(match));
  }
}

module.exports = { LOBBY_ROOM, LobbyManager };
