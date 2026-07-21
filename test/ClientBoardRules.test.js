'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getLegalDeploymentPositions,
  getLegalMovementPositions,
  isLegalDeployment,
  isLegalMovement,
} = require('../public/boardRules');

function emptyBoard() {
  return Array.from({ length: 10 }, () => Array(10).fill(null));
}

function monster(id, ownerId) {
  return { id, ownerId, type: 'ghost' };
}

test('client deployment highlights follow the player edge', () => {
  const board = emptyBoard();
  const player = { userId: 'north', edge: 'north' };

  assert.equal(getLegalDeploymentPositions(board, player).length, 10);
  assert.equal(isLegalDeployment(board, player, 0, 5), true);
  assert.equal(isLegalDeployment(board, player, 1, 5), false);

  board[0][4] = monster('friendly', 'north');
  board[0][5] = monster('enemy', 'south');
  assert.equal(isLegalDeployment(board, player, 0, 4), false);
  assert.equal(isLegalDeployment(board, player, 0, 5), true);
});

test('client movement highlights include every straight and short diagonal move', () => {
  const board = emptyBoard();
  board[4][4] = monster('mover', 'north');

  const positions = getLegalMovementPositions(board, 'north', 4, 4);
  assert.equal(positions.length, 26);
  assert.equal(isLegalMovement(board, 'north', 4, 4, 4, 9), true);
  assert.equal(isLegalMovement(board, 'north', 4, 4, 6, 6), true);
  assert.equal(isLegalMovement(board, 'north', 4, 4, 7, 7), false);
  assert.equal(isLegalMovement(board, 'north', 4, 4, 6, 5), false);
});

test('client movement highlights allow friendly jumps but stop at enemies', () => {
  const board = emptyBoard();
  board[5][1] = monster('mover', 'north');
  board[5][3] = monster('friendly', 'north');
  board[5][5] = monster('enemy', 'south');

  assert.equal(isLegalMovement(board, 'north', 5, 1, 5, 3), false);
  assert.equal(isLegalMovement(board, 'north', 5, 1, 5, 4), true);
  assert.equal(isLegalMovement(board, 'north', 5, 1, 5, 5), true);
  assert.equal(isLegalMovement(board, 'north', 5, 1, 5, 6), false);
});
