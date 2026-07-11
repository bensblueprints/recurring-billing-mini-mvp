require('dotenv').config();
const path = require('path');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 5358;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'billoop.db');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const ALLOW_TEST_NOW = process.env.ALLOW_TEST_NOW === '1';

const app = createApp({ dbPath: DB_PATH, adminPassword: ADMIN_PASSWORD, allowTestNow: ALLOW_TEST_NOW });

app.listen(PORT, () => {
  console.log(`Billoop listening on http://localhost:${PORT}`);
  if (ADMIN_PASSWORD === 'admin') {
    console.log('⚠ Using default admin password — set ADMIN_PASSWORD in .env for production.');
  }
  if (ALLOW_TEST_NOW) {
    console.log('⚠ ALLOW_TEST_NOW=1 — deterministic-time test mode is enabled. Never run production like this.');
  }
});
