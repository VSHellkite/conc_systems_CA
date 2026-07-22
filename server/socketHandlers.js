'use strict';

const userStore = require('./userStore');

function registerSocketHandlers(io, gameManager) {
  io.on('connection', (socket) => {
    const userId = socket.request.session?.userId;
    const user = userId ? userStore.getPublicUser(userId) : null;

    if (!user) {
      socket.disconnect(true);
      return;
    }

    socket.emit('account:state', user);

    const game = gameManager.reconnect(userId, socket.id);
    if (game) {
      socket.emit('game:started', game.getPublicState());
      socket.emit('game:actionAccepted', game.getPrivateTurnState(userId));
    }

    socket.on('lobby:join', ({ modeId } = {}) => {
      try {
        if (gameManager.userGameIndex.has(userId)) return;
        gameManager.joinLobby(userStore.getPublicUser(userId), socket.id, modeId);
      } catch (error) {
        socket.emit('server:error', { message: error.message });
      }
    });

    socket.on('lobby:ready', () => {
      try {
        gameManager.readyPlayer(userId);
      } catch (error) {
        socket.emit('server:error', { message: error.message });
      }
    });

    socket.on('lobby:leave', () => gameManager.leaveLobby(userId));

    socket.on('game:placeMonster', async ({ gameId, type, row, column } = {}) => {
      try {
        await gameManager.placeMonster(userId, gameId, type, row, column);
      } catch (error) {
        socket.emit('server:error', { message: error.message });
      }
    });

    socket.on('game:moveMonster', async ({ gameId, monsterId, row, column } = {}) => {
      try {
        await gameManager.moveMonster(userId, gameId, monsterId, row, column);
      } catch (error) {
        socket.emit('server:error', { message: error.message });
      }
    });

    socket.on('game:skipTurn', async ({ gameId } = {}) => {
      try {
        await gameManager.skipTurn(userId, gameId);
      } catch (error) {
        socket.emit('server:error', { message: error.message });
      }
    });

    socket.on('disconnect', () => gameManager.disconnect(userId));
  });
}

module.exports = { registerSocketHandlers };
