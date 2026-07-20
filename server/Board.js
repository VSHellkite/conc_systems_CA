'use strict';

const { BOARD_SIZE, isValidPosition, toCoordinate } = require('./gameRules');

class Board {
  constructor() {
    this.size = BOARD_SIZE;
    this.grid = Array.from(
      { length: BOARD_SIZE },
      () => Array(BOARD_SIZE).fill(null),
    );
  }

  getCell(row, column) {
    this.requireValidPosition(row, column);
    return this.grid[row][column];
  }

  placeMonster(monster) {
    this.requireValidPosition(monster.row, monster.column);

    if (this.grid[monster.row][monster.column]) {
      throw new Error(`${toCoordinate(monster.row, monster.column)} is already occupied.`);
    }

    this.grid[monster.row][monster.column] = monster;
  }

  removeMonster(monster) {
    if (
      isValidPosition(monster.row, monster.column)
      && this.grid[monster.row][monster.column] === monster
    ) {
      this.grid[monster.row][monster.column] = null;
    }
  }

  setCell(row, column, monster) {
    this.requireValidPosition(row, column);
    this.grid[row][column] = monster;

    if (monster) {
      monster.row = row;
      monster.column = column;
    }
  }

  validateMove(monster, destinationRow, destinationColumn) {
    if (!isValidPosition(destinationRow, destinationColumn)) {
      return { legal: false, reason: 'Destination is outside the board.' };
    }

    if (this.grid[monster.row]?.[monster.column] !== monster) {
      return { legal: false, reason: 'Monster is not on its recorded board position.' };
    }

    const rowDistance = destinationRow - monster.row;
    const columnDistance = destinationColumn - monster.column;

    if (rowDistance === 0 && columnDistance === 0) {
      return { legal: false, reason: 'A monster must move to another cell.' };
    }

    const isStraight = rowDistance === 0 || columnDistance === 0;
    const isDiagonal = Math.abs(rowDistance) === Math.abs(columnDistance);

    if (!isStraight && !isDiagonal) {
      return { legal: false, reason: 'A monster must move in a straight or diagonal line.' };
    }

    if (isDiagonal && Math.abs(rowDistance) > 2) {
      return { legal: false, reason: 'Diagonal movement is limited to two cells.' };
    }

    const distance = Math.max(Math.abs(rowDistance), Math.abs(columnDistance));
    const rowStep = Math.sign(rowDistance);
    const columnStep = Math.sign(columnDistance);

    for (let step = 1; step < distance; step += 1) {
      const occupant = this.grid[
        monster.row + rowStep * step
      ][
        monster.column + columnStep * step
      ];

      if (occupant && occupant.ownerId !== monster.ownerId) {
        return { legal: false, reason: 'An enemy monster blocks the path.' };
      }
    }

    const destination = this.grid[destinationRow][destinationColumn];
    if (destination && destination.ownerId === monster.ownerId) {
      return { legal: false, reason: 'The destination contains a friendly monster.' };
    }

    return { legal: true, destination };
  }

  moveMonster(monster, destinationRow, destinationColumn) {
    const validation = this.validateMove(monster, destinationRow, destinationColumn);

    if (!validation.legal) {
      throw new Error(validation.reason);
    }

    this.grid[monster.row][monster.column] = null;
    monster.row = destinationRow;
    monster.column = destinationColumn;
    this.grid[destinationRow][destinationColumn] = monster;

    return validation.destination;
  }

  serialize() {
    return this.grid.map((row) => row.map((monster) => (
      monster
        ? {
          id: monster.id,
          type: monster.type,
          ownerId: monster.ownerId,
        }
        : null
    )));
  }

  requireValidPosition(row, column) {
    if (!isValidPosition(row, column)) {
      throw new RangeError('Board position is outside the 10 by 10 board.');
    }
  }
}

module.exports = { Board };
