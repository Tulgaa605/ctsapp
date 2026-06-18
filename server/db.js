const mysql = require('mysql2/promise');
require('dotenv').config();

function parseDatabaseUrl(url) {
  if (!url) {
    throw new Error('DATABASE_URL is not set in server/.env');
  }

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

const config = parseDatabaseUrl(process.env.DATABASE_URL);

const pool = mysql.createPool({
  ...config,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

function rowToItem(row) {
  return {
    id: row.id,
    lordID: row.lord_id,
    account: row.account,
    assetCode: row.asset_code,
    unitPrice: row.unit_price,
    date: row.date_str,
    serialNumber: row.serial_number,
    orgCode: row.org_code,
    raw: row.raw_data,
    handler: row.handler,
    assetName: row.asset_name,
    unitType: row.unit_type,
    deviceId: row.device_id,
    year: row.year,
    month: row.month,
    tag: row.tag,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function itemToRow(item) {
  return {
    lord_id: item.lordID || '',
    account: item.account || '',
    asset_code: item.assetCode,
    unit_price: item.unitPrice != null ? String(item.unitPrice) : '',
    date_str: item.date || '',
    serial_number: item.serialNumber,
    org_code: item.orgCode || '',
    raw_data: item.raw,
    handler: item.handler || '',
    asset_name: item.assetName || '',
    unit_type: item.unitType || '',
    device_id: item.deviceId || '',
    year: item.year,
    month: item.month,
    tag: item.tag || 'CT$FS4',
    created_at: item.createdAt ? new Date(item.createdAt) : new Date(),
  };
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scan_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lord_id VARCHAR(255) DEFAULT '',
      account VARCHAR(255) DEFAULT '',
      asset_code VARCHAR(255) NOT NULL,
      unit_price VARCHAR(64) DEFAULT '',
      date_str VARCHAR(64) DEFAULT '',
      serial_number VARCHAR(255) NOT NULL,
      org_code VARCHAR(255) DEFAULT '',
      raw_data TEXT NOT NULL,
      handler VARCHAR(255) DEFAULT '',
      asset_name VARCHAR(512) DEFAULT '',
      unit_type VARCHAR(128) DEFAULT '',
      device_id VARCHAR(255) DEFAULT '',
      year INT NOT NULL,
      month INT NOT NULL,
      tag VARCHAR(64) DEFAULT 'CT$FS4',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_asset_serial (asset_code, serial_number),
      INDEX idx_year_month (year, month),
      INDEX idx_created_at (created_at)
    )
  `);
}

async function listHistory({ year, month } = {}) {
  let sql = 'SELECT * FROM scan_history';
  const params = [];

  if (year && month) {
    sql += ' WHERE year = ? AND month = ?';
    params.push(year, month);
  }

  sql += ' ORDER BY created_at DESC';
  const [rows] = await pool.query(sql, params);
  return rows.map(rowToItem);
}

async function createHistoryItem(item) {
  const row = itemToRow(item);
  const [result] = await pool.query(
    `INSERT INTO scan_history (
      lord_id, account, asset_code, unit_price, date_str, serial_number, org_code,
      raw_data, handler, asset_name, unit_type, device_id, year, month, tag, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.lord_id, row.account, row.asset_code, row.unit_price, row.date_str,
      row.serial_number, row.org_code, row.raw_data, row.handler, row.asset_name,
      row.unit_type, row.device_id, row.year, row.month, row.tag, row.created_at,
    ]
  );

  const [rows] = await pool.query('SELECT * FROM scan_history WHERE id = ?', [result.insertId]);
  return rowToItem(rows[0]);
}

async function deleteHistoryByIds(ids) {
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const [result] = await pool.query(
    `DELETE FROM scan_history WHERE id IN (${placeholders})`,
    ids
  );
  return result.affectedRows;
}

async function deleteAllHistory() {
  const [result] = await pool.query('DELETE FROM scan_history');
  return result.affectedRows;
}

module.exports = {
  pool,
  ensureSchema,
  listHistory,
  createHistoryItem,
  deleteHistoryByIds,
  deleteAllHistory,
  rowToItem,
};
