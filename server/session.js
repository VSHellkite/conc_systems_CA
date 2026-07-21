'use strict';

const session = require('express-session');

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'monster-mayhem-development-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  },
});

module.exports = { sessionMiddleware };
