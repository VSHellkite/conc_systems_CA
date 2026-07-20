'use strict';

const BOARD_SIZE = 10;
const COLUMN_NAMES = 'ABCDEFGHIJ';
const board = document.getElementById('board');

function placementZones(row, column) {
  const zones = [];

  if (row === 0) zones.push(1);
  if (row === BOARD_SIZE - 1) zones.push(2);
  if (column === 0) zones.push(3);
  if (column === BOARD_SIZE - 1) zones.push(4);

  return zones;
}

function addLabel(text, className) {
  const label = document.createElement('div');
  label.className = className;
  label.textContent = text;
  board.appendChild(label);
}

function createBoard() {
  addLabel('', 'axis-label axis-corner');

  for (const columnName of COLUMN_NAMES) {
    addLabel(columnName, 'axis-label');
  }

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    addLabel(String(row + 1), 'axis-label');

    for (let column = 0; column < BOARD_SIZE; column += 1) {
      const coordinate = `${COLUMN_NAMES[column]}${row + 1}`;
      const cell = document.createElement('button');
      const zones = placementZones(row, column);

      cell.type = 'button';
      cell.className = `board-cell ${(row + column) % 2 === 0 ? 'light' : 'dark'}`;
      cell.dataset.row = String(row);
      cell.dataset.column = String(column);
      cell.dataset.coordinate = coordinate;
      cell.setAttribute('aria-label', coordinate);

      if (zones.length > 0) {
        cell.classList.add(`zone-${zones.join('-')}`);
      }

      const coordinateLabel = document.createElement('span');
      coordinateLabel.className = 'cell-coordinate';
      coordinateLabel.textContent = coordinate;
      cell.appendChild(coordinateLabel);
      board.appendChild(cell);
    }
  }
}

createBoard();
