'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { Server } = require('socket.io');
const { GameManager } = require('./server/GameManager');
const { sessionMiddleware } = require('./server/session');
const { registerSocketHandlers } = require('./server/socketHandlers');
const userStore = require('./server/userStore');

const app = express();

app.use(express.json());
app.use(sessionMiddleware);
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/register', async (request, response) => {
  try {
    const user = await userStore.register(request.body?.username, request.body?.password);
    request.session.userId = user.userId;
    response.status(201).json(user);
  } catch (error) {
    response.status(409).json({ message: error.message });
  }
});

app.post('/api/login', async (request, response) => {
  const user = await userStore.authenticate(request.body?.username, request.body?.password);

  if (!user) {
    response.status(401).json({ message: 'Invalid username or password.' });
    return;
  }

  request.session.userId = user.userId;
  response.json(user);
});

app.post('/api/logout', (request, response) => {
  request.session.destroy(() => response.status(204).end());
});

app.get('/api/me', (request, response) => {
  const user = request.session.userId
    ? userStore.getPublicUser(request.session.userId)
    : null;

  if (!user) {
    response.status(401).json({ message: 'Not logged in.' });
    return;
  }

  response.json(user);
});

const server = http.createServer(app);
const io = new Server(server);

io.engine.use(sessionMiddleware);

const gameManager = new GameManager(io);
registerSocketHandlers(io, gameManager);

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`Monster Mayhem is running at http://localhost:${port}`);
});
