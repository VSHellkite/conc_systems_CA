'use strict';

const BOARD_SIZE = 10;
const STARTING_MONSTER_COUNT = 10;
const ELIMINATION_THRESHOLD = 10;
const ROUND_DURATION_MS = 60_000;
const REVEAL_DURATION_MS = 3_000;
const MONSTER_TYPES = Object.freeze(['ghost', 'vampire', 'werewolf']);
const BEATS = Object.freeze({
  ghost: 'vampire',
  vampire: 'werewolf',
  werewolf: 'ghost',
});
const PLAYER_CONFIGS = Object.freeze([
  Object.freeze({ number: 1, edge: 'north', colorName: 'dark blue', color: '#163b76' }),
  Object.freeze({ number: 2, edge: 'south', colorName: 'white', color: '#f4f3ef' }),
  Object.freeze({ number: 3, edge: 'west', colorName: 'teal', color: '#21b9bb' }),
  Object.freeze({ number: 4, edge: 'east', colorName: 'pink', color: '#ef78b5' }),
]);

function isValidPosition(row, column) {
  return Number.isInteger(row)
    && Number.isInteger(column)
    && row >= 0
    && row < BOARD_SIZE
    && column >= 0
    && column < BOARD_SIZE;
}

function isPlacementPosition(edge, row, column) {
  if (!isValidPosition(row, column)) return false;

  if (edge === 'north') return row === 0;
  if (edge === 'south') return row === BOARD_SIZE - 1;
  if (edge === 'west') return column === 0;
  if (edge === 'east') return column === BOARD_SIZE - 1;

  return false;
}

function toCoordinate(row, column) {
  if (!isValidPosition(row, column)) {
    throw new RangeError('Board position is outside the 10 by 10 board.');
  }

  return `${String.fromCharCode(65 + column)}${row + 1}`;
}

module.exports = {
  BEATS,
  BOARD_SIZE,
  ELIMINATION_THRESHOLD,
  MONSTER_TYPES,
  PLAYER_CONFIGS,
  REVEAL_DURATION_MS,
  ROUND_DURATION_MS,
  STARTING_MONSTER_COUNT,
  isPlacementPosition,
  isValidPosition,
  toCoordinate,
};
