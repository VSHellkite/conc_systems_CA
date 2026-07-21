'use strict';

const { Board } = require('./Board');
const { resolveCellCombat } = require('./Monster');
const { Player } = require('./Player');
const {
  INACTIVITY_ELIMINATION_THRESHOLD,
  REVEAL_DURATION_MS,
  ROUND_DURATION_MS,
  getGameMode,
  toCoordinate,
} = require('./gameRules');

class Game {
  constructor(id, joiningUsers, now = Date.now(), modeId = 'standard') {
    if (joiningUsers.length < 2 || joiningUsers.length > 4) {
      throw new Error('A game requires between two and four players.');
    }

    this.id = id;
    this.mode = getGameMode(modeId);
    this.board = new Board();
    this.roundNumber = 1;
    this.phase = 'planning';
    this.status = 'active';
    this.roundEndsAt = now + ROUND_DURATION_MS;
    this.revealEndsAt = null;
    this.winnerId = null;
    this.actionLog = [];
    this.pendingActions = [];
    this.lastResolution = null;
    this.players = joiningUsers.map((user, index) => {
      const player = new Player(user, index + 1, this.mode.startingMonsterCount);
      player.socketId = user.socketId;
      player.gamesWon = user.gamesWon;
      player.gamesLost = user.gamesLost;
      player.gamesDrawn = user.gamesDrawn || 0;
      player.connected = true;
      player.eliminated = false;
      player.consecutiveSkips = 0;
      player.roundOutcome = null;
      player.result = null;
      player.hasEndedTurn = false;
      player.hasActedThisRound = false;
      player.privatePreview = null;
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

  placeMonster(userId, type, row, column, now = Date.now()) {
    const player = this.requirePlanningPlayer(userId);

    const occupant = this.board.getCell(row, column);
    if (occupant?.ownerId === userId) {
      throw new Error('A friendly monster already occupies this cell.');
    }

    const monster = player.createMonster(type, row, column);

    this.actionLog.push({
      kind: 'deployment',
      username: player.username,
      monsterType: type,
      coordinate: toCoordinate(row, column),
    });

    const action = {
      kind: 'deployment',
      monster,
      destination: { row, column },
    };
    this.completePlayerAction(player, action, {
      kind: 'deployment',
      monster: {
        id: monster.id,
        type: monster.type,
        ownerId: monster.ownerId,
      },
      destination: { row, column },
    }, now);

    return this.getPrivateTurnState(userId);
  }

  moveMonster(userId, monsterId, destinationRow, destinationColumn, now = Date.now()) {
    const player = this.requirePlanningPlayer(userId);
    const monster = player.monsters.get(monsterId);

    if (!monster) throw new Error('You do not own this monster.');
    if (monster.isNew) throw new Error('A newly deployed monster cannot move this round.');
    if (monster.hasMoved) throw new Error('This monster has already moved this round.');

    const validation = this.board.validateMove(monster, destinationRow, destinationColumn);
    if (!validation.legal) throw new Error(validation.reason);

    const originRow = monster.row;
    const originColumn = monster.column;
    const origin = toCoordinate(originRow, originColumn);
    this.actionLog.push({
      kind: 'movement',
      username: player.username,
      monsterType: monster.type,
      from: origin,
      coordinate: toCoordinate(destinationRow, destinationColumn),
    });

    const action = {
      kind: 'movement',
      monster,
      origin: { row: originRow, column: originColumn },
      destination: { row: destinationRow, column: destinationColumn },
    };
    this.completePlayerAction(player, action, {
      kind: 'movement',
      monster: {
        id: monster.id,
        type: monster.type,
        ownerId: monster.ownerId,
      },
      origin: {
        row: originRow,
        column: originColumn,
      },
      destination: {
        row: destinationRow,
        column: destinationColumn,
      },
    }, now);

    return this.getPrivateTurnState(userId);
  }

  completePlayerAction(player, action, privatePreview, now = Date.now()) {
    this.pendingActions.push(action);
    player.hasActedThisRound = true;
    player.hasEndedTurn = true;
    player.privatePreview = privatePreview;
    player.roundOutcome = 'action';
    this.resolveIfReady(now);
  }

  skipTurn(userId, now = Date.now()) {
    const player = this.requirePlanningPlayer(userId);
    player.hasActedThisRound = true;
    player.hasEndedTurn = true;
    player.privatePreview = null;
    player.roundOutcome = 'skip';
    this.resolveIfReady(now);
    return this.getPrivateTurnState(userId);
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
      if (!player.eliminated && !player.hasEndedTurn) {
        player.hasActedThisRound = true;
        player.hasEndedTurn = true;
        player.privatePreview = null;
        player.roundOutcome = 'timeout';
      }
    }

    this.resolveRound('timeout', now);
    return true;
  }

  resolveRound(reason, now = Date.now()) {
    if (this.phase !== 'planning') return false;

    this.phase = 'reveal';
    this.roundEndsAt = null;
    this.revealEndsAt = now + REVEAL_DURATION_MS;
    this.applyPendingActions();
    this.applyRoundOutcomes();
    const eliminations = this.removeEliminatedPlayers();
    this.lastResolution = {
      roundNumber: this.roundNumber,
      reason,
      actions: this.actionLog.map((action) => ({ ...action })),
      eliminations,
    };
    this.captureVisibleState();
    return true;
  }

  applyPendingActions() {
    const arrivals = new Map();

    for (const action of this.pendingActions) {
      if (action.kind === 'movement') this.board.removeMonster(action.monster);
    }

    for (const action of this.pendingActions) {
      const { monster, destination } = action;
      const key = `${destination.row}:${destination.column}`;
      monster.row = destination.row;
      monster.column = destination.column;
      if (action.kind === 'movement') monster.hasMoved = true;
      if (!arrivals.has(key)) arrivals.set(key, []);
      arrivals.get(key).push(monster);
    }

    for (const [key, arrivingMonsters] of arrivals) {
      const [row, column] = key.split(':').map(Number);
      const occupant = this.board.getCell(row, column);
      const contenders = occupant ? [occupant, ...arrivingMonsters] : arrivingMonsters;
      const result = resolveCellCombat(contenders);

      for (const defeatedMonster of result.defeated) {
        this.getPlayer(defeatedMonster.ownerId).removeMonster(defeatedMonster.id);
      }

      this.board.setCell(row, column, result.survivor);
    }
  }

  applyRoundOutcomes() {
    for (const player of this.players) {
      if (player.eliminated) continue;

      if (player.roundOutcome === 'action') player.consecutiveSkips = 0;
      else if (player.roundOutcome === 'skip' || player.roundOutcome === 'timeout') {
        player.consecutiveSkips += 1;
      }
    }
  }

  removeEliminatedPlayers() {
    const newlyEliminated = [];

    for (const player of this.players) {
      const lostByMonsters = player.removedCount >= this.mode.eliminationThreshold;
      const lostByInactivity = player.consecutiveSkips >= INACTIVITY_ELIMINATION_THRESHOLD;
      if (player.eliminated || (!lostByMonsters && !lostByInactivity)) continue;

      player.eliminated = true;
      player.hasEndedTurn = true;
      newlyEliminated.push({
        player,
        reason: lostByInactivity ? 'inactivity' : 'monsters',
      });

      for (const monster of player.monsters.values()) {
        this.board.removeMonster(monster);
      }

      player.monsters.clear();
    }

    const eliminationResult = newlyEliminated.length > 1 ? 'draw' : 'loss';
    for (const { player } of newlyEliminated) player.result = eliminationResult;

    const survivors = this.players.filter((player) => !player.eliminated);
    if (survivors.length <= 1) {
      this.status = 'finished';
      this.winnerId = survivors[0]?.userId || null;
      if (survivors[0]) survivors[0].result = 'win';
    }

    return newlyEliminated.map(({ player, reason }) => ({
      userId: player.userId,
      username: player.username,
      reason,
      result: player.result,
    }));
  }

  startNextRound(now = Date.now()) {
    if (this.status !== 'active' || this.phase !== 'reveal') return false;

    this.roundNumber += 1;
    this.phase = 'planning';
    this.roundEndsAt = now + ROUND_DURATION_MS;
    this.revealEndsAt = null;
    this.actionLog = [];
    this.pendingActions = [];
    this.lastResolution = null;

    for (const player of this.players) {
      player.hasEndedTurn = player.eliminated;
      player.hasActedThisRound = false;
      player.privatePreview = null;
      player.roundOutcome = null;

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
      player.hasActedThisRound = true;
      player.hasEndedTurn = true;
      player.privatePreview = null;
      player.roundOutcome = 'skip';
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
      consecutiveSkips: player.consecutiveSkips,
      result: player.result,
    }]));
  }

  getPrivateTurnState(userId) {
    const player = this.getPlayer(userId);

    return {
      hasActedThisRound: player.hasActedThisRound,
      preview: player.privatePreview ? { ...player.privatePreview } : null,
      reserves: { ...player.reserves },
    };
  }

  getPublicState(now = Date.now()) {
    const revealCurrentState = this.phase === 'reveal' || this.status === 'finished';
    const winner = this.winnerId ? this.getPlayer(this.winnerId) : null;

    return {
      id: this.id,
      mode: { ...this.mode },
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
            consecutiveSkips: player.consecutiveSkips,
            result: player.result,
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
          gamesDrawn: player.gamesDrawn,
          connected: player.connected,
          hasEndedTurn: player.hasEndedTurn,
          hasActedThisRound: player.hasActedThisRound,
          reserves: { ...visible.reserves },
          removedCount: visible.removedCount,
          monsterCount: visible.monsterCount,
          eliminated: visible.eliminated,
          consecutiveSkips: visible.consecutiveSkips,
          result: visible.result,
        };
      }),
    };
  }
}

module.exports = { Game };
