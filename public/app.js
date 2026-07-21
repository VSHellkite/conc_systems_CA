'use strict';

const BOARD_SIZE = 10;
const COLUMN_NAMES = 'ABCDEFGHIJ';

let currentUser = null;
let socket = null;
let toastTimer = null;

const element = (id) => document.getElementById(id);

function showScreen(screenName) {
  document.querySelectorAll('.screen').forEach((screen) => screen.classList.add('hidden'));
  element(`screen-${screenName}`).classList.remove('hidden');
}

function showToast(message) {
  const toast = element('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

function updateAccount(user) {
  currentUser = user;
  element('header-username').textContent = user.username;
  element('stat-wins').textContent = user.gamesWon;
  element('stat-losses').textContent = user.gamesLost;
  element('account-summary').classList.remove('hidden');
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || 'Request failed.');
  }

  return data;
}

async function authenticate(endpoint) {
  const username = element('auth-username').value.trim();
  const password = element('auth-password').value;

  try {
    const user = await postJson(endpoint, { username, password });
    element('auth-error').textContent = '';
    updateAccount(user);
    connectSocket();
    showScreen('lobby');
  } catch (error) {
    element('auth-error').textContent = error.message;
  }
}

element('auth-form').addEventListener('submit', (event) => {
  event.preventDefault();
  authenticate('/api/login');
});

element('btn-register').addEventListener('click', () => authenticate('/api/register'));

element('btn-logout').addEventListener('click', async () => {
  if (socket) socket.disconnect();
  await fetch('/api/logout', { method: 'POST' });
  currentUser = null;
  socket = null;
  element('account-summary').classList.add('hidden');
  element('auth-form').reset();
  showScreen('auth');
});

function connectSocket() {
  if (socket) socket.disconnect();
  socket = io();

  socket.on('connect', () => socket.emit('lobby:join'));
  socket.on('account:state', updateAccount);
  socket.on('lobby:state', ({ players }) => renderLobby(players));
  socket.on('match:started', renderMatch);
  socket.on('match:state', renderMatch);
  socket.on('match:closed', () => {
    showScreen('lobby');
    socket.emit('lobby:join');
  });
  socket.on('server:error', ({ message }) => showToast(message));
}

function renderLobby(players) {
  const list = element('lobby-players');
  list.replaceChildren();

  players.forEach((player) => {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    const record = document.createElement('span');

    name.textContent = player.username;
    record.textContent = `${player.gamesWon} wins / ${player.gamesLost} losses`;
    item.append(name, record);
    list.appendChild(item);
  });

  element('btn-start').disabled = players.length < 2;
}

element('btn-start').addEventListener('click', () => socket.emit('lobby:start'));
element('btn-close-match').addEventListener('click', () => socket.emit('match:close'));

function renderMatch(match) {
  showScreen('game');
  const panel = element('match-players');
  panel.replaceChildren();

  match.players.forEach((player) => {
    const card = document.createElement('article');
    const marker = document.createElement('i');
    const details = document.createElement('div');
    const name = document.createElement('strong');
    const assignment = document.createElement('span');
    const record = document.createElement('small');

    card.className = 'player-card';
    if (!player.connected) card.classList.add('disconnected');
    marker.style.backgroundColor = player.color;
    name.textContent = player.username;
    assignment.textContent = `Player ${player.number} · ${player.edge} · ${player.colorName}`;
    record.textContent = `${player.gamesWon} wins / ${player.gamesLost} losses${player.connected ? '' : ' · disconnected'}`;
    details.append(name, assignment, record);
    card.append(marker, details);
    panel.appendChild(card);
  });
}

function placementZones(row, column) {
  const zones = [];
  if (row === 0) zones.push(1);
  if (row === BOARD_SIZE - 1) zones.push(2);
  if (column === 0) zones.push(3);
  if (column === BOARD_SIZE - 1) zones.push(4);
  return zones;
}

function addBoardLabel(text) {
  const label = document.createElement('div');
  label.className = 'axis-label';
  label.textContent = text;
  element('board').appendChild(label);
}

function createBoard() {
  addBoardLabel('');
  for (const columnName of COLUMN_NAMES) addBoardLabel(columnName);

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    addBoardLabel(String(row + 1));

    for (let column = 0; column < BOARD_SIZE; column += 1) {
      const coordinate = `${COLUMN_NAMES[column]}${row + 1}`;
      const zones = placementZones(row, column);
      const cell = document.createElement('button');
      const label = document.createElement('span');

      cell.type = 'button';
      cell.className = `board-cell ${(row + column) % 2 === 0 ? 'light' : 'dark'}`;
      cell.setAttribute('aria-label', coordinate);
      if (zones.length > 0) cell.classList.add(`zone-${zones.join('-')}`);

      label.className = 'cell-coordinate';
      label.textContent = coordinate;
      cell.appendChild(label);
      element('board').appendChild(cell);
    }
  }
}

async function initialize() {
  createBoard();

  try {
    const response = await fetch('/api/me');
    if (!response.ok) throw new Error();
    updateAccount(await response.json());
    connectSocket();
    showScreen('lobby');
  } catch {
    showScreen('auth');
  }
}

initialize();
