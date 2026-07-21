'use strict';

const userStore = require('./userStore');
const { LOBBY_ROOM } = require('./LobbyManager');

function registerSocketHandlers(io, lobbyManager) {
  io.on('connection', (socket) => {
    const userId = socket.request.session?.userId;
    const user = userId ? userStore.getPublicUser(userId) : null;

    if (!user) {
      socket.disconnect(true);
      return;
    }

    socket.emit('account:state', user);

    const match = lobbyManager.reconnect(userId, socket.id);
    if (match) {
      socket.emit('match:started', lobbyManager.getMatchState(match));
    }

    socket.on('lobby:join', () => {
      if (lobbyManager.userMatchIndex.has(userId)) return;
      socket.join(LOBBY_ROOM);
      lobbyManager.joinLobby(user, socket.id);
    });

    socket.on('lobby:start', () => {
      try {
        lobbyManager.startMatch(userId);
      } catch (error) {
        socket.emit('server:error', { message: error.message });
      }
    });

    socket.on('match:close', () => lobbyManager.closeMatch(userId));
    socket.on('disconnect', () => lobbyManager.disconnect(userId));
  });
}

module.exports = { registerSocketHandlers };
