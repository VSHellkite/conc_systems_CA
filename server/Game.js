'use strict';

const { Board } = require('./Board');
const { resolveCombat } = require('./Monster');
const { Player } = require('./Player');
const {
  ELIMINATION_THRESHOLD,
  REVEAL_DURATION_MS,
  ROUND_DURATION_MS,
  toCoordinate,
} = require('./gameRules');

class Game {
  constructor(id, joiningUsers, now = Date.now()) {
    if (joiningUsers.length < 2 || joiningUsers.length > 4) {
      throw new Error('A game requires between two and four players.');
    }

    this.id = id;
    this.board = new Board();
    this.roundNumber = 1;
    this.phase = 'planning';
    this.status = 'active';
    this.roundEndsAt = now + ROUND_DURATION_MS;
    this.revealEndsAt = null;
    this.winnerId = null;
    this.actionLog = [];
    this.lastResolution = null;
    this.players = joiningUsers.map((user, index) => {
      const player = new Player(user, index + 1);
      player.socketId = user.socketId;
      player.gamesWon = user.gamesWon;
      player.gamesLost = user.gamesLost;
      player.connected = true;
      player.eliminated = false;
      player.hasEndedTurn = false;
      player.hasPlacedThisRound = false;
      return player;
    });
    this.captureVisibleState();
  }

  getPlayer(userId) {
    return this.players.find((player) => player.userId === userId) || null;
  }

  requirePlanningPlayer(userId) {
    const player = this.getPlayer(userId);

    if (!player) throw new Error('You are not a player in this game.');
    if (this.status !== 'active') throw new Error('This game has finished.');
    if (this.phase !== 'planning') throw new Error('Actions are locked during the reveal.');
    if (player.eliminated) throw new Error('You have been eliminated.');
    if (player.hasEndedTurn) throw new Error('You have already ended this turn.');

    return player;
  }

  placeMonster(userId, type, row, column) {
    const player = this.requirePlanningPlayer(userId);

    if (player.hasPlacedThisRound) {
      throw new Error('Only one monster may be deployed each round.');
    }

    const occupant = this.board.getCell(row, column);
    if (occupant?.ownerId === userId) {
      throw new Error('A friendly monster already occupies this cell.');
    }

    const monster = player.createMonster(type, row, column);
    player.hasPlacedThisRound = true;

    if (occupant) {
      this.settleCombat(player, monster, occupant, row, column);
    } else {
      this.board.placeMonster(monster);
    }

    this.actionLog.push({
      kind: 'deployment',
      username: player.username,
      monsterType: type,
      coordinate: toCoordinate(row, column),
    });

    return this.getPrivateTurnState(userId);
  }

  moveMonster(userId, monsterId, destinationRow, destinationColumn) {
    const player = this.requirePlanningPlayer(userId);
    const monster = player.monsters.get(monsterId);

    if (!monster) throw new Error('You do not own this monster.');
    if (monster.isNew) throw new Error('A newly deployed monster cannot move this round.');
    if (monster.hasMoved) throw new Error('This monster has already moved this round.');

    const origin = toCoordinate(monster.row, monster.column);
    const occupant = this.board.moveMonster(monster, destinationRow, destinationColumn);
    monster.hasMoved = true;

    if (occupant) {
      this.settleCombat(player, monster, occupant, destinationRow, destinationColumn);
    }

    this.actionLog.push({
      kind: 'movement',
      username: player.username,
      monsterType: monster.type,
      from: origin,
      coordinate: toCoordinate(destinationRow, destinationColumn),
    });

    return this.getPrivateTurnState(userId);
  }

  settleCombat(movingPlayer, movingMonster, occupant, row, column) {
    const result = resolveCombat(movingMonster, occupant);

    for (const defeatedMonster of result.defeated) {
      const owner = this.getPlayer(defeatedMonster.ownerId);
      owner.removeMonster(defeatedMonster.id);
    }

    this.board.setCell(row, column, result.survivor);
  }

  endTurn(userId, now = Date.now()) {
    const player = this.requirePlanningPlayer(userId);
    player.hasEndedTurn = true;
    this.resolveIfReady(now);
  }

  resolveIfReady(now = Date.now()) {
    const activePlayers = this.players.filter((player) => !player.eliminated);

    if (activePlayers.every((player) => player.hasEndedTurn)) {
      this.resolveRound('all-ready', now);
      return true;
    }

    return false;
  }

  expireRound(now = Date.now()) {
    if (this.status !== 'active' || this.phase !== 'planning') return false;

    for (const player of this.players) {
      if (!player.eliminated) player.hasEndedTurn = true;
    }

    this.resolveRound('timeout', now);
    return true;
  }

  resolveRound(reason, now = Date.now()) {
    if (this.phase !== 'planning') return false;

    this.phase = 'reveal';
    this.roundEndsAt = null;
    this.revealEndsAt = now + REVEAL_DURATION_MS;
    this.removeEliminatedPlayers();
    this.lastResolution = {
      roundNumber: this.roundNumber,
      reason,
      actions: this.actionLog.map((action) => ({ ...action })),
    };
    this.captureVisibleState();
    return true;
  }

  removeEliminatedPlayers() {
    for (const player of this.players) {
      if (player.eliminated || player.removedCount < ELIMINATION_THRESHOLD) continue;

      player.eliminated = true;
      player.hasEndedTurn = true;

      for (const monster of player.monsters.values()) {
        this.board.removeMonster(monster);
      }

      player.monsters.clear();
    }

    const survivors = this.players.filter((player) => !player.eliminated);
    if (survivors.length <= 1) {
      this.status = 'finished';
      this.winnerId = survivors[0]?.userId || null;
    }
  }

  startNextRound(now = Date.now()) {
    if (this.status !== 'active' || this.phase !== 'reveal') return false;

    this.roundNumber += 1;
    this.phase = 'planning';
    this.roundEndsAt = now + ROUND_DURATION_MS;
    this.revealEndsAt = null;
    this.actionLog = [];
    this.lastResolution = null;

    for (const player of this.players) {
      player.hasEndedTurn = player.eliminated;
      player.hasPlacedThisRound = false;

      for (const monster of player.monsters.values()) {
        monster.hasMoved = false;
        monster.isNew = false;
      }
    }

    return true;
  }

  disconnectPlayer(userId, now = Date.now()) {
    const player = this.getPlayer(userId);
    if (!player) return false;

    player.connected = false;

    if (this.status === 'active' && this.phase === 'planning' && !player.eliminated) {
      player.hasEndedTurn = true;
      this.resolveIfReady(now);
    }

    return true;
  }

  reconnectPlayer(userId, socketId) {
    const player = this.getPlayer(userId);
    if (!player) return false;

    player.socketId = socketId;
    player.connected = true;
    return true;
  }

  captureVisibleState() {
    this.visibleBoard = this.board.serialize();
    this.visiblePlayers = new Map(this.players.map((player) => [player.userId, {
      reserves: { ...player.reserves },
      removedCount: player.removedCount,
      monsterCount: player.monsters.size,
      eliminated: player.eliminated,
    }]));
  }

  getPrivateTurnState(userId) {
    const player = this.getPlayer(userId);

    return {
      hasPlacedThisRound: player.hasPlacedThisRound,
      movedMonsterIds: Array.from(player.monsters.values())
        .filter((monster) => monster.hasMoved)
        .map((monster) => monster.id),
      reserves: { ...player.reserves },
    };
  }

  getPublicState(now = Date.now()) {
    const revealCurrentState = this.phase === 'reveal' || this.status === 'finished';
    const winner = this.winnerId ? this.getPlayer(this.winnerId) : null;

    return {
      id: this.id,
      roundNumber: this.roundNumber,
      phase: this.phase,
      status: this.status,
      roundEndsAt: this.roundEndsAt,
      revealEndsAt: this.revealEndsAt,
      serverTime: now,
      winnerUsername: winner?.username || null,
      lastResolution: revealCurrentState ? this.lastResolution : null,
      board: revealCurrentState ? this.board.serialize() : this.visibleBoard,
      players: this.players.map((player) => {
        const visible = revealCurrentState
          ? {
            reserves: player.reserves,
            removedCount: player.removedCount,
            monsterCount: player.monsters.size,
            eliminated: player.eliminated,
          }
          : this.visiblePlayers.get(player.userId);

        return {
          userId: player.userId,
          username: player.username,
          number: player.number,
          edge: player.edge,
          colorName: player.colorName,
          color: player.color,
          gamesWon: player.gamesWon,
          gamesLost: player.gamesLost,
          connected: player.connected,
          hasEndedTurn: player.hasEndedTurn,
          reserves: { ...visible.reserves },
          removedCount: visible.removedCount,
          monsterCount: visible.monsterCount,
          eliminated: visible.eliminated,
        };
      }),
    };
  }
}

module.exports = { Game };
