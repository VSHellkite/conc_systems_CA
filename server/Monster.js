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

function resolveCellCombat(monsters) {
  if (monsters.length === 0) return { survivor: null, defeated: [] };
  if (monsters.length === 1) return { survivor: monsters[0], defeated: [] };

  const possibleSurvivors = monsters.filter((monster) => !monsters.some(
    (opponent) => opponent !== monster && BEATS[opponent.type] === monster.type,
  ));

  if (possibleSurvivors.length === 1) {
    const survivor = possibleSurvivors[0];
    return {
      survivor,
      defeated: monsters.filter((monster) => monster !== survivor),
    };
  }

  return { survivor: null, defeated: [...monsters] };
}

module.exports = { Monster, resolveCellCombat, resolveCombat };
