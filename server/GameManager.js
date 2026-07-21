'use strict';

const { randomUUID } = require('node:crypto');
const { Game } = require('./Game');
const {
  GAME_MODES,
  REVEAL_DURATION_MS,
  ROUND_DURATION_MS,
  getGameMode,
} = require('./gameRules');
const userStore = require('./userStore');

const lobbyRoom = (modeId) => `lobby:${modeId}`;
const gameRoom = (gameId) => `game:${gameId}`;

class GameManager {
  constructor(io) {
    this.io = io;
    this.lobbies = new Map(Object.keys(GAME_MODES).map((modeId) => [modeId, []]));
    this.userLobbyIndex = new Map();
    this.games = new Map();
    this.userGameIndex = new Map();
    this.roundTimers = new Map();
    this.revealTimers = new Map();
  }

  getSocket(socketId) {
    return this.io.sockets.sockets.get(socketId);
  }

  joinLobby(user, socketId, modeId) {
    const mode = getGameMode(modeId);
    if (this.userGameIndex.has(user.userId)) return null;

    const previousModeId = this.userLobbyIndex.get(user.userId);
    if (previousModeId && previousModeId !== mode.id) this.leaveLobby(user.userId);

    const lobby = this.lobbies.get(mode.id);
    const waitingPlayer = lobby.find((player) => player.userId === user.userId);
    if (waitingPlayer) waitingPlayer.socketId = socketId;
    else lobby.push({ ...user, socketId, ready: false });

    this.userLobbyIndex.set(user.userId, mode.id);
    const socket = this.getSocket(socketId);
    if (socket) socket.join(lobbyRoom(mode.id));
    this.broadcastLobby(mode.id);

    return lobby.length === 4 ? this.startGame(mode.id, true) : null;
  }

  leaveLobby(userId) {
    const modeId = this.userLobbyIndex.get(userId);
    if (!modeId) return false;

    const lobby = this.lobbies.get(modeId);
    const player = lobby.find((entry) => entry.userId === userId);
    this.lobbies.set(modeId, lobby.filter((entry) => entry.userId !== userId));
    this.userLobbyIndex.delete(userId);

    const socket = player ? this.getSocket(player.socketId) : null;
    if (socket) socket.leave(lobbyRoom(modeId));
    this.broadcastLobby(modeId);

    const remainingPlayers = this.lobbies.get(modeId);
    if (remainingPlayers.length >= 2 && remainingPlayers.every((entry) => entry.ready)) {
      this.startGame(modeId);
    }
    return true;
  }

  broadcastLobby(modeId) {
    const mode = getGameMode(modeId);
    this.io.to(lobbyRoom(mode.id)).emit('lobby:state', {
      mode: { ...mode },
      players: this.lobbies.get(mode.id).map((player) => ({
        userId: player.userId,
        username: player.username,
        gamesWon: player.gamesWon,
        gamesLost: player.gamesLost,
        gamesDrawn: player.gamesDrawn || 0,
        ready: player.ready,
      })),
    });
  }

  readyPlayer(userId) {
    const modeId = this.userLobbyIndex.get(userId);
    if (!modeId) throw new Error('You are not waiting in a lobby.');

    const lobby = this.lobbies.get(modeId);
    const player = lobby.find((entry) => entry.userId === userId);
    player.ready = true;
    this.broadcastLobby(modeId);

    return lobby.length >= 2 && lobby.every((entry) => entry.ready)
      ? this.startGame(modeId)
      : null;
  }

  startGame(modeId, automatic = false) {
    const mode = getGameMode(modeId);
    const lobby = this.lobbies.get(mode.id);
    if (lobby.length < 2) {
      throw new Error('At least two players are required to start a game.');
    }
    if (!automatic && !lobby.every((player) => player.ready)) {
      throw new Error('Every player must be ready to start the game.');
    }

    const selectedUsers = lobby.splice(0, 4);
    const game = new Game(randomUUID(), selectedUsers, Date.now(), mode.id);
    this.games.set(game.id, game);

    for (const player of game.players) {
      this.userLobbyIndex.delete(player.userId);
      this.userGameIndex.set(player.userId, game.id);
      const socket = this.getSocket(player.socketId);

      if (socket) {
        socket.leave(lobbyRoom(mode.id));
        socket.join(gameRoom(game.id));
      }
    }

    this.io.to(gameRoom(game.id)).emit('game:started', game.getPublicState());
    this.broadcastLobby(mode.id);
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

  async skipTurn(userId, gameId) {
    const game = this.requireGame(userId, gameId);
    const privateState = game.skipTurn(userId);
    this.emitActionAccepted(game, userId, privateState);
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
      const fallbackResult = game.winnerId
        ? (player.userId === game.winnerId ? 'win' : 'loss')
        : 'draw';
      const updatedUser = await userStore.recordResult(
        player.userId,
        player.result || fallbackResult,
      );
      if (updatedUser) {
        player.gamesWon = updatedUser.gamesWon;
        player.gamesLost = updatedUser.gamesLost;
        player.gamesDrawn = updatedUser.gamesDrawn;
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

module.exports = { GameManager, lobbyRoom };
