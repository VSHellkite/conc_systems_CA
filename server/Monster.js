'use strict';

const { randomUUID } = require('node:crypto');
const { BEATS, MONSTER_TYPES } = require('./gameRules');

class Monster {
  constructor(type, ownerId, row, column, id = randomUUID()) {
    if (!MONSTER_TYPES.includes(type)) {
      throw new TypeError(`Unknown monster type: ${type}`);
    }
    if (!ownerId) {
      throw new TypeError('A monster must have an owner.');
    }

    this.id = id;
    this.type = type;
    this.ownerId = ownerId;
    this.row = row;
    this.column = column;
    this.hasMoved = false;
    this.isNew = true;
  }
}

function resolveCombat(firstMonster, secondMonster) {
  if (firstMonster.type === secondMonster.type) {
    return { survivor: null, defeated: [firstMonster, secondMonster] };
  }

  if (BEATS[firstMonster.type] === secondMonster.type) {
    return { survivor: firstMonster, defeated: [secondMonster] };
  }

  return { survivor: secondMonster, defeated: [firstMonster] };
}

module.exports = { Monster, resolveCombat };
