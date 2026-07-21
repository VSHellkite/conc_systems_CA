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
    element('action-status').textContent = state.preview
      ? 'Your action is visible only to you until the reveal.'
      : 'You skipped this round.';
    renderBoard();
    renderPlayers();
    renderGameStatus();
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

    name.textContent = player.username;
    item.append(name);
    list.appendChild(item);
  });

  element('btn-start').disabled = players.length < 2;
}

element('btn-start').addEventListener('click', () => socket.emit('lobby:start'));
element('btn-close-game').addEventListener('click', () => socket.emit('game:close'));
element('btn-return-lobby').addEventListener('click', returnToLobby);
element('btn-skip-turn').addEventListener('click', () => {
  if (currentGame) socket.emit('game:skipTurn', { gameId: currentGame.id });
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

  if (state.phase !== 'planning') privateTurnState = null;

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
  } else if (player?.hasEndedTurn || privateTurnState?.hasActedThisRound) {
    element('game-status').textContent = 'Waiting for other players';
    element('action-status').textContent = privateTurnState?.preview
      ? 'Your action is visible only to you until the reveal.'
      : 'Your turn is locked.';
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
  const hasActed = privateTurnState?.hasActedThisRound || false;
  const reserves = privateTurnState?.reserves || player.reserves;
  const controls = element('placement-controls');

  controls.replaceChildren();

  for (const type of ['ghost', 'vampire', 'werewolf']) {
    const button = document.createElement('button');
    const image = document.createElement('img');
    const name = document.createElement('span');
    const count = document.createElement('strong');

    button.type = 'button';
    button.className = 'monster-button';
    button.dataset.type = type;
    button.disabled = locked || hasActed || reserves[type] === 0;
    button.classList.toggle('active', placingType === type);
    image.src = spritePath(type, player.number);
    image.alt = '';
    name.textContent = type;
    count.textContent = reserves[type];
    button.append(image, name, count);
    button.addEventListener('click', () => {
      placingType = placingType === type ? null : type;
      selectedMonsterId = null;
      renderControls();
    });
    controls.appendChild(button);
  }

  element('btn-skip-turn').disabled = locked || hasActed;
}

function spritePath(type, playerNumber) {
  return `/assets/${type}${playerNumber}_64x64.png`;
}

function renderBoard() {
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let column = 0; column < BOARD_SIZE; column += 1) {
      const button = boardCells[row][column];
      const cell = displayedCell(row, column);
      button.querySelector('.monster-sprite')?.remove();
      button.classList.remove('selected-monster');
      button.classList.remove('planned-action');

      if (!cell) continue;

      const owner = currentGame.players.find((player) => player.userId === cell.ownerId);
      const sprite = document.createElement('img');
      sprite.className = 'monster-sprite';
      sprite.src = spritePath(cell.type, owner.number);
      sprite.alt = `${owner.username}'s ${cell.type}`;
      sprite.title = sprite.alt;
      button.appendChild(sprite);

      const destination = privateTurnState?.preview?.destination;
      if (
        currentGame.phase === 'planning'
        && destination?.row === row
        && destination?.column === column
      ) {
        button.classList.add('planned-action');
      }

      if (cell.id === selectedMonsterId) button.classList.add('selected-monster');
    }
  }
}

function displayedCell(row, column) {
  const preview = currentGame.phase === 'planning' ? privateTurnState?.preview : null;
  if (!preview) return currentGame.board[row][column];

  if (preview.kind === 'movement'
    && preview.origin.row === row
    && preview.origin.column === column) {
    return null;
  }

  if (preview.destination.row === row && preview.destination.column === column) {
    return preview.monster;
  }

  return currentGame.board[row][column];
}

function onBoardCellClick(row, column) {
  const player = currentPlayer();
  if (
    !currentGame
    || currentGame.phase !== 'planning'
    || currentGame.status !== 'active'
    || player?.hasEndedTurn
    || privateTurnState?.hasActedThisRound
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
    const state = document.createElement('small');
    const resources = document.createElement('div');

    card.className = 'player-card';
    if (!player.connected) card.classList.add('disconnected');
    marker.style.backgroundColor = player.color;
    name.textContent = player.username;

    let turnState = player.hasEndedTurn ? 'ready' : 'planning';
    if (player.userId === currentUser.userId && privateTurnState?.hasActedThisRound) {
      turnState = 'ready';
    }
    if (!player.connected) turnState = 'disconnected';
    if (player.eliminated) turnState = 'eliminated';
    state.textContent = `${player.removedCount}/10 removed - ${turnState}`;
    resources.className = 'player-resources';

    const reserves = player.userId === currentUser.userId && privateTurnState
      ? privateTurnState.reserves
      : player.reserves;

    for (const type of ['ghost', 'vampire', 'werewolf']) {
      const resource = document.createElement('span');
      const image = document.createElement('img');
      const count = document.createElement('b');

      resource.className = 'player-resource';
      image.src = spritePath(type, player.number);
      image.alt = type;
      count.textContent = reserves[type];
      resource.append(image, count);
      resources.appendChild(resource);
    }

    details.append(name, state, resources);
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
