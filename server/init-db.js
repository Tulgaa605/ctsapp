require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

function parseDatabaseUrl(url) {
  const normalized = url.replace(/^mysql:\/\//, 'http://');
  const parsed = new URL(normalized);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
  };
}

async function initDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.startsWith('mysql://')) {
    console.error('DATABASE_URL must be mysql://... in server/.env');
    process.exit(1);
  }

  const config = parseDatabaseUrl(databaseUrl);
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    multipleStatements: true,
  });

  await connection.query(schemaSql);
  await connection.end();

  console.log(`Database ready: ${config.database} @ ${config.host}:${config.port}`);
}

initDb().catch((error) => {
  console.error('init-db failed:', error.message);
  process.exit(1);
});
