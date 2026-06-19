require('dotenv').config();

const databaseUrl = process.env.DATABASE_URL || 'json:./data/history.json';

if (databaseUrl.startsWith('mysql://')) {
  module.exports = require('./db-mysql');
} else {
  module.exports = require('./db-json');
}
