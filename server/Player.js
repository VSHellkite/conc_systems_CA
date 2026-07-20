'use strict';

const { Monster } = require('./Monster');
const {
  MONSTER_TYPES,
  PLAYER_CONFIGS,
  STARTING_MONSTER_COUNT,
  isPlacementPosition,
} = require('./gameRules');

class Player {
  constructor({ userId, username }, playerNumber) {
    const config = PLAYER_CONFIGS[playerNumber - 1];

    if (!userId || !username) {
      throw new TypeError('A player requires a user ID and username.');
    }
    if (!config) {
      throw new RangeError('Player number must be between 1 and 4.');
    }

    this.userId = userId;
    this.username = username;
    this.number = config.number;
    this.edge = config.edge;
    this.colorName = config.colorName;
    this.color = config.color;
    this.monsters = new Map();
    this.reserves = Object.fromEntries(
      MONSTER_TYPES.map((type) => [type, STARTING_MONSTER_COUNT]),
    );
    this.removedCount = 0;
  }

  createMonster(type, row, column) {
    if (!MONSTER_TYPES.includes(type)) {
      throw new TypeError(`Unknown monster type: ${type}`);
    }
    if (!isPlacementPosition(this.edge, row, column)) {
      throw new Error(`Player ${this.number} may only deploy on the ${this.edge} edge.`);
    }
    if (this.reserves[type] === 0) {
      throw new Error(`No ${type} monsters remain in reserve.`);
    }

    const monster = new Monster(type, this.userId, row, column);
    this.reserves[type] -= 1;
    this.monsters.set(monster.id, monster);
    return monster;
  }

  removeMonster(monsterId) {
    if (!this.monsters.delete(monsterId)) return false;

    this.removedCount += 1;
    return true;
  }

  ownsMonster(monsterId) {
    return this.monsters.has(monsterId);
  }

  getSpritePath(type) {
    if (!MONSTER_TYPES.includes(type)) {
      throw new TypeError(`Unknown monster type: ${type}`);
    }

    return `/assets/${type}${this.number}_64x64.png`;
  }
}

module.exports = { Player };
