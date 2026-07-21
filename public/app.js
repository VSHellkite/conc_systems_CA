'use strict';

const BOARD_SIZE = 10;
const COLUMN_NAMES = 'ABCDEFGHIJ';

let currentUser = null;
let socket = null;
let currentGame = null;
let selectedMonsterId = null;
let placingType = null;
let privateTurnState = null;
let clockOffset = 0;
let toastTimer = null;

const boardCells = [];
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

  if (!response.ok) throw new Error(data.message || 'Request failed.');
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
  currentGame = null;
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
  socket.on('game:started', receiveGameState);
  socket.on('game:state', receiveGameState);
  socket.on('game:actionAccepted', (state) => {
    privateTurnState = state;
    placingType = null;
    selectedMonsterId = null;
    element('action-status').textContent = 'Action accepted and hidden until the reveal.';
    renderControls();
  });
  socket.on('game:finished', (state) => {
    receiveGameState(state);
    element('finished-message').textContent = state.winnerUsername
      ? `${state.winnerUsername} wins the game.`
      : 'The game ended in a draw.';
    element('finished-banner').classList.remove('hidden');
  });
  socket.on('game:closed', returnToLobby);
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
element('btn-close-game').addEventListener('click', () => socket.emit('game:close'));
element('btn-return-lobby').addEventListener('click', returnToLobby);
element('btn-end-turn').addEventListener('click', () => {
  if (currentGame) socket.emit('game:endTurn', { gameId: currentGame.id });
});

document.querySelectorAll('.monster-button').forEach((button) => {
  button.addEventListener('click', () => {
    placingType = placingType === button.dataset.type ? null : button.dataset.type;
    selectedMonsterId = null;
    renderControls();
  });
});

function returnToLobby() {
  currentGame = null;
  privateTurnState = null;
  selectedMonsterId = null;
  placingType = null;
  element('finished-banner').classList.add('hidden');
  showScreen('lobby');
  if (socket?.connected) socket.emit('lobby:join');
}

function receiveGameState(state) {
  const isNewRound = !currentGame || currentGame.roundNumber !== state.roundNumber;
  currentGame = state;
  clockOffset = state.serverTime - Date.now();

  if (isNewRound) {
    privateTurnState = null;
    selectedMonsterId = null;
    placingType = null;
  }

  showScreen('game');
  renderBoard();
  renderPlayers();
  renderGameStatus();
  renderControls();
  renderRoundLog();
  updateTimer();
}

function currentPlayer() {
  return currentGame?.players.find((player) => player.userId === currentUser?.userId) || null;
}

function renderGameStatus() {
  const player = currentPlayer();
  element('round-label').textContent = `Round ${currentGame.roundNumber}`;

  if (currentGame.status === 'finished') {
    element('game-status').textContent = 'Game finished';
  } else if (currentGame.phase === 'reveal') {
    element('game-status').textContent = 'Revealing all actions';
    element('action-status').textContent = 'The next round will begin shortly.';
  } else if (player?.hasEndedTurn) {
    element('game-status').textContent = 'Waiting for other players';
    element('action-status').textContent = 'Your turn is locked.';
  } else {
    element('game-status').textContent = 'Plan your actions';
    element('action-status').textContent = 'Your actions remain hidden until the round ends.';
  }
}

function renderControls() {
  if (!currentGame) return;
  const player = currentPlayer();
  const locked = currentGame.phase !== 'planning'
    || currentGame.status !== 'active'
    || player?.hasEndedTurn
    || player?.eliminated;
  const hasPlaced = privateTurnState?.hasPlacedThisRound || false;

  document.querySelectorAll('.monster-button').forEach((button) => {
    button.disabled = locked || hasPlaced;
    button.classList.toggle('active', placingType === button.dataset.type);
  });

  element('btn-end-turn').disabled = locked;
}

function renderBoard() {
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let column = 0; column < BOARD_SIZE; column += 1) {
      const button = boardCells[row][column];
      const cell = currentGame.board[row][column];
      button.querySelector('.monster-token')?.remove();
      button.classList.remove('selected-monster');

      if (!cell) continue;

      const owner = currentGame.players.find((player) => player.userId === cell.ownerId);
      const token = document.createElement('span');
      token.className = `monster-token player-${owner.number}`;
      token.textContent = cell.type[0].toUpperCase();
      token.title = `${owner.username}: ${cell.type}`;
      button.appendChild(token);

      if (cell.id === selectedMonsterId) button.classList.add('selected-monster');
    }
  }
}

function onBoardCellClick(row, column) {
  const player = currentPlayer();
  if (
    !currentGame
    || currentGame.phase !== 'planning'
    || currentGame.status !== 'active'
    || player?.hasEndedTurn
  ) return;

  const cell = currentGame.board[row][column];

  if (placingType) {
    socket.emit('game:placeMonster', {
      gameId: currentGame.id,
      type: placingType,
      row,
      column,
    });
    return;
  }

  if (cell?.ownerId === currentUser.userId) {
    if (privateTurnState?.movedMonsterIds.includes(cell.id)) {
      showToast('This monster has already moved this round.');
      return;
    }

    selectedMonsterId = selectedMonsterId === cell.id ? null : cell.id;
    renderBoard();
    return;
  }

  if (selectedMonsterId) {
    socket.emit('game:moveMonster', {
      gameId: currentGame.id,
      monsterId: selectedMonsterId,
      row,
      column,
    });
  }
}

function renderPlayers() {
  const panel = element('match-players');
  panel.replaceChildren();

  currentGame.players.forEach((player) => {
    const card = document.createElement('article');
    const marker = document.createElement('i');
    const details = document.createElement('div');
    const name = document.createElement('strong');
    const assignment = document.createElement('span');
    const state = document.createElement('small');

    card.className = 'player-card';
    if (!player.connected) card.classList.add('disconnected');
    marker.style.backgroundColor = player.color;
    name.textContent = player.username;
    assignment.textContent = `Player ${player.number} · ${player.edge}`;

    let turnState = player.hasEndedTurn ? 'ready' : 'planning';
    if (!player.connected) turnState = 'disconnected';
    if (player.eliminated) turnState = 'eliminated';
    state.textContent = `${player.removedCount}/10 removed · ${turnState}`;

    details.append(name, assignment, state);
    card.append(marker, details);
    panel.appendChild(card);
  });
}

function renderRoundLog() {
  const log = element('round-log');
  const resolution = currentGame.lastResolution;

  if (!resolution) {
    log.classList.add('hidden');
    log.replaceChildren();
    return;
  }

  const heading = document.createElement('strong');
  heading.textContent = resolution.reason === 'timeout'
    ? 'Round ended by the timer'
    : 'All players ended their turns';
  const list = document.createElement('ul');

  resolution.actions.forEach((action) => {
    const item = document.createElement('li');
    item.textContent = action.kind === 'deployment'
      ? `${action.username} deployed ${action.monsterType} at ${action.coordinate}.`
      : `${action.username} moved ${action.monsterType} from ${action.from} to ${action.coordinate}.`;
    list.appendChild(item);
  });

  if (resolution.actions.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'No actions were submitted.';
    list.appendChild(item);
  }

  log.replaceChildren(heading, list);
  log.classList.remove('hidden');
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
    boardCells[row] = [];
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
      cell.addEventListener('click', () => onBoardCellClick(row, column));
      element('board').appendChild(cell);
      boardCells[row][column] = cell;
    }
  }
}

function updateTimer() {
  if (!currentGame) return;
  const deadline = currentGame.phase === 'planning'
    ? currentGame.roundEndsAt
    : currentGame.revealEndsAt;

  if (!deadline) {
    element('round-timer').textContent = '00:00';
    return;
  }

  const remaining = Math.max(0, deadline - (Date.now() + clockOffset));
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  element('round-timer').textContent = `${minutes}:${seconds}`;
}

async function initialize() {
  createBoard();
  setInterval(updateTimer, 250);

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
