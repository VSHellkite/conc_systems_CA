'use strict';

const path = require('node:path');
const express = require('express');

const app = express();

app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(express.static(path.join(__dirname, 'public')));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Monster Mayhem is running at http://localhost:${port}`);
});
