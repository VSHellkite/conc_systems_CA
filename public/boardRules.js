'use strict';

(function exposeBoardRules(scope) {
  const size = 10;

  function isInsideBoard(row, column) {
    return Number.isInteger(row)
      && Number.isInteger(column)
      && row >= 0
      && row < size
      && column >= 0
      && column < size;
  }

  function isOnPlayerEdge(edge, row, column) {
    if (!isInsideBoard(row, column)) return false;
    if (edge === 'north') return row === 0;
    if (edge === 'south') return row === size - 1;
    if (edge === 'west') return column === 0;
    if (edge === 'east') return column === size - 1;
    return false;
  }

  function isLegalDeployment(board, player, row, column) {
    if (!player || !isOnPlayerEdge(player.edge, row, column)) return false;
    const occupant = board[row][column];
    return !occupant || occupant.ownerId !== player.userId;
  }

  function isLegalMovement(board, ownerId, originRow, originColumn, row, column) {
    if (!isInsideBoard(originRow, originColumn) || !isInsideBoard(row, column)) return false;

    const monster = board[originRow][originColumn];
    if (!monster || monster.ownerId !== ownerId) return false;

    const rowDistance = row - originRow;
    const columnDistance = column - originColumn;
    if (rowDistance === 0 && columnDistance === 0) return false;

    const isStraight = rowDistance === 0 || columnDistance === 0;
    const isDiagonal = Math.abs(rowDistance) === Math.abs(columnDistance);
    if (!isStraight && !isDiagonal) return false;
    if (isDiagonal && Math.abs(rowDistance) > 2) return false;

    const distance = Math.max(Math.abs(rowDistance), Math.abs(columnDistance));
    const rowStep = Math.sign(rowDistance);
    const columnStep = Math.sign(columnDistance);

    for (let step = 1; step < distance; step += 1) {
      const occupant = board[
        originRow + rowStep * step
      ][
        originColumn + columnStep * step
      ];
      if (occupant && occupant.ownerId !== ownerId) return false;
    }

    const destination = board[row][column];
    return !destination || destination.ownerId !== ownerId;
  }

  function getLegalDeploymentPositions(board, player) {
    const positions = [];
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        if (isLegalDeployment(board, player, row, column)) positions.push({ row, column });
      }
    }
    return positions;
  }

  function getLegalMovementPositions(board, ownerId, originRow, originColumn) {
    const positions = [];
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        if (isLegalMovement(board, ownerId, originRow, originColumn, row, column)) {
          positions.push({ row, column });
        }
      }
    }
    return positions;
  }

  const boardRules = {
    getLegalDeploymentPositions,
    getLegalMovementPositions,
    isLegalDeployment,
    isLegalMovement,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = boardRules;
  else scope.boardRules = boardRules;
}(globalThis));
