'use strict';

const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const DEFAULT_FILE_PATH = path.join(__dirname, '..', 'data', 'users.json');

class UserStore {
  constructor(filePath = DEFAULT_FILE_PATH) {
    this.filePath = filePath;
    this.users = new Map();
    this.writeQueue = Promise.resolve();
    this.load();
  }

  load() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });

    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, '{}\n');
    }

    const content = fs.readFileSync(this.filePath, 'utf8');
    const records = JSON.parse(content);

    for (const [userId, record] of Object.entries(records)) {
      this.users.set(userId, record);
    }
  }

  persist() {
    const snapshot = JSON.stringify(Object.fromEntries(this.users), null, 2);
    const temporaryPath = `${this.filePath}.tmp`;

    this.writeQueue = this.writeQueue.then(async () => {
      await fs.promises.writeFile(temporaryPath, snapshot);
      await fs.promises.rename(temporaryPath, this.filePath);
    });

    return this.writeQueue;
  }

  toPublicUser(userId, record) {
    return {
      userId,
      username: record.username,
      gamesWon: record.gamesWon,
      gamesLost: record.gamesLost,
      gamesDrawn: record.gamesDrawn || 0,
    };
  }

  async register(rawUsername, password) {
    const username = String(rawUsername || '').trim();
    const userId = username.toLowerCase();

    if (username.length < 3 || username.length > 24) {
      throw new Error('Username must contain between 3 and 24 characters.');
    }
    if (String(password || '').length < 6) {
      throw new Error('Password must contain at least 6 characters.');
    }
    if (this.users.has(userId)) {
      throw new Error('Username is already taken.');
    }

    const record = {
      username,
      passwordHash: await bcrypt.hash(password, 10),
      gamesWon: 0,
      gamesLost: 0,
      gamesDrawn: 0,
    };

    this.users.set(userId, record);
    await this.persist();
    return this.toPublicUser(userId, record);
  }

  async authenticate(rawUsername, password) {
    const userId = String(rawUsername || '').trim().toLowerCase();
    const record = this.users.get(userId);

    if (!record || !await bcrypt.compare(String(password || ''), record.passwordHash)) {
      return null;
    }

    return this.toPublicUser(userId, record);
  }

  getPublicUser(userId) {
    const record = this.users.get(userId);
    return record ? this.toPublicUser(userId, record) : null;
  }

  async recordResult(userId, outcome) {
    const record = this.users.get(userId);
    if (!record) return null;

    const result = outcome === true ? 'win' : outcome === false ? 'loss' : outcome;
    if (!['win', 'loss', 'draw'].includes(result)) {
      throw new TypeError('A game result must be win, loss, or draw.');
    }

    if (result === 'win') record.gamesWon += 1;
    if (result === 'loss') record.gamesLost += 1;
    if (result === 'draw') record.gamesDrawn = (record.gamesDrawn || 0) + 1;

    await this.persist();
    return this.toPublicUser(userId, record);
  }
}

const userStore = new UserStore();

module.exports = userStore;
module.exports.UserStore = UserStore;
