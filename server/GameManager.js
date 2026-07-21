'use strict';

const { randomUUID } = require('node:crypto');
const { Game } = require('./Game');
const { REVEAL_DURATION_MS, ROUND_DURATION_MS } = require('./gameRules');
const userStore = require('./userStore');

const LOBBY_ROOM = 'lobby';
const gameRoom = (gameId) => `game:${gameId}`;

class GameManager {
  constructor(io) {
    this.io = io;
    this.waitingPlayers = [];
    this.games = new Map();
    this.userGameIndex = new Map();
    this.roundTimers = new Map();
    this.revealTimers = new Map();
  }

  getSocket(socketId) {
    return this.io.sockets.sockets.get(socketId);
  }

  joinLobby(user, socketId) {
    if (this.userGameIndex.has(user.userId)) return;

    const waitingPlayer = this.waitingPlayers.find((player) => player.userId === user.userId);
    if (waitingPlayer) waitingPlayer.socketId = socketId;
    else this.waitingPlayers.push({ ...user, socketId });

    this.broadcastLobby();
    if (this.waitingPlayers.length === 4) this.startGame(user.userId);
  }

  leaveLobby(userId) {
    const previousLength = this.waitingPlayers.length;
    this.waitingPlayers = this.waitingPlayers.filter((player) => player.userId !== userId);
    if (this.waitingPlayers.length !== previousLength) this.broadcastLobby();
  }

  broadcastLobby() {
    this.io.to(LOBBY_ROOM).emit('lobby:state', {
      players: this.waitingPlayers.map((player) => ({
        userId: player.userId,
        username: player.username,
        gamesWon: player.gamesWon,
        gamesLost: player.gamesLost,
      })),
    });
  }

  startGame(requestingUserId) {
    if (!this.waitingPlayers.some((player) => player.userId === requestingUserId)) {
      throw new Error('You are not waiting in the lobby.');
    }
    if (this.waitingPlayers.length < 2) {
      throw new Error('At least two players are required to start a game.');
    }

    const selectedUsers = this.waitingPlayers.splice(0, 4);
    const game = new Game(randomUUID(), selectedUsers);
    this.games.set(game.id, game);

    for (const player of game.players) {
      this.userGameIndex.set(player.userId, game.id);
      const socket = this.getSocket(player.socketId);

      if (socket) {
        socket.leave(LOBBY_ROOM);
        socket.join(gameRoom(game.id));
      }
    }

    this.io.to(gameRoom(game.id)).emit('game:started', game.getPublicState());
    this.broadcastLobby();
    this.scheduleRoundTimeout(game);
    return game;
  }

  requireGame(userId, gameId) {
    const game = this.games.get(gameId);
    if (!game) throw new Error('Game not found.');
    if (!game.getPlayer(userId)) throw new Error('You are not a player in this game.');
    return game;
  }

  async placeMonster(userId, gameId, type, row, column) {
    const game = this.requireGame(userId, gameId);
    const privateState = game.placeMonster(userId, type, row, column);
    this.emitActionAccepted(game, userId, privateState);
    await this.publishGame(game);
  }

  async moveMonster(userId, gameId, monsterId, row, column) {
    const game = this.requireGame(userId, gameId);
    const privateState = game.moveMonster(userId, monsterId, row, column);
    this.emitActionAccepted(game, userId, privateState);
    await this.publishGame(game);
  }

  async endTurn(userId, gameId) {
    const game = this.requireGame(userId, gameId);
    game.endTurn(userId);
    await this.publishGame(game);
  }

  emitActionAccepted(game, userId, privateState) {
    const player = game.getPlayer(userId);
    const socket = this.getSocket(player.socketId);
    if (socket) socket.emit('game:actionAccepted', privateState);
  }

  async publishGame(game) {
    if (game.phase === 'planning') {
      this.io.to(gameRoom(game.id)).emit('game:state', game.getPublicState());
      return;
    }

    this.clearTimer(this.roundTimers, game.id);

    if (game.status === 'finished') {
      await this.finishGame(game);
      return;
    }

    this.io.to(gameRoom(game.id)).emit('game:state', game.getPublicState());
    this.scheduleNextRound(game);
  }

  scheduleRoundTimeout(game) {
    this.clearTimer(this.roundTimers, game.id);
    const timer = setTimeout(async () => {
      if (!this.games.has(game.id) || !game.expireRound()) return;
      await this.publishGame(game);
    }, ROUND_DURATION_MS);
    timer.unref();
    this.roundTimers.set(game.id, timer);
  }

  scheduleNextRound(game) {
    if (this.revealTimers.has(game.id)) return;

    const timer = setTimeout(() => {
      this.revealTimers.delete(game.id);
      if (!this.games.has(game.id) || !game.startNextRound()) return;
      this.io.to(gameRoom(game.id)).emit('game:state', game.getPublicState());
      this.scheduleRoundTimeout(game);
    }, REVEAL_DURATION_MS);

    timer.unref();
    this.revealTimers.set(game.id, timer);
  }

  async finishGame(game) {
    if (game.finishProcessed) return;
    game.finishProcessed = true;

    for (const player of game.players) {
      const updatedUser = await userStore.recordResult(player.userId, player.userId === game.winnerId);
      if (updatedUser) {
        player.gamesWon = updatedUser.gamesWon;
        player.gamesLost = updatedUser.gamesLost;
        const socket = this.getSocket(player.socketId);
        if (socket) socket.emit('account:state', updatedUser);
      }
      this.userGameIndex.delete(player.userId);
    }

    this.io.to(gameRoom(game.id)).emit('game:finished', game.getPublicState());
    this.clearGameTimers(game.id);
    this.games.delete(game.id);
  }

  reconnect(userId, socketId) {
    const gameId = this.userGameIndex.get(userId);
    const game = gameId ? this.games.get(gameId) : null;
    if (!game) return null;

    game.reconnectPlayer(userId, socketId);
    const socket = this.getSocket(socketId);
    if (socket) socket.join(gameRoom(game.id));
    this.io.to(gameRoom(game.id)).emit('game:state', game.getPublicState());
    return game;
  }

  async disconnect(userId) {
    this.leaveLobby(userId);
    const gameId = this.userGameIndex.get(userId);
    const game = gameId ? this.games.get(gameId) : null;
    if (!game) return;

    game.disconnectPlayer(userId);
    await this.publishGame(game);
  }

  closeGame(userId) {
    const gameId = this.userGameIndex.get(userId);
    const game = gameId ? this.games.get(gameId) : null;
    if (!game) return;

    this.io.to(gameRoom(game.id)).emit('game:closed');

    for (const player of game.players) {
      this.userGameIndex.delete(player.userId);
      const socket = this.getSocket(player.socketId);
      if (socket) socket.leave(gameRoom(game.id));
    }

    this.clearGameTimers(game.id);
    this.games.delete(game.id);
  }

  clearGameTimers(gameId) {
    this.clearTimer(this.roundTimers, gameId);
    this.clearTimer(this.revealTimers, gameId);
  }

  clearTimer(collection, gameId) {
    const timer = collection.get(gameId);
    if (timer) clearTimeout(timer);
    collection.delete(gameId);
  }
}

module.exports = { GameManager, LOBBY_ROOM };
