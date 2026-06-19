const fs = require('fs');
const path = require('path');
require('dotenv').config();

function resolveDataPath() {
  const raw = process.env.DATABASE_URL || 'json:./data/history.json';
  const filePart = raw.replace(/^json:/, '').trim();
  return path.isAbsolute(filePart)
    ? filePart
    : path.join(__dirname, filePart);
}

const dataPath = resolveDataPath();

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

function readRows() {
  if (!fs.existsSync(dataPath)) return [];
  const parsed = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

function writeRows(rows) {
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.writeFileSync(dataPath, JSON.stringify(rows, null, 2), 'utf8');
}

async function ensureSchema() {
  if (!fs.existsSync(dataPath)) {
    writeRows([]);
  }
}

async function listHistory({ year, month } = {}) {
  let rows = readRows();
  if (year && month) {
    rows = rows.filter((row) => row.year === year && row.month === month);
  }
  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return rows.map(rowToItem);
}

async function createHistoryItem(item) {
  const rows = readRows();
  const row = itemToRow(item);

  const duplicate = rows.some(
    (existing) =>
      existing.asset_code === row.asset_code &&
      existing.serial_number === row.serial_number
  );
  if (duplicate) {
    const error = new Error('Duplicate asset already saved');
    error.code = 'ER_DUP_ENTRY';
    throw error;
  }

  const nextId = rows.reduce((max, existing) => Math.max(max, Number(existing.id) || 0), 0) + 1;
  const saved = { id: nextId, ...row };
  rows.push(saved);
  writeRows(rows);
  return rowToItem(saved);
}

async function deleteHistoryByIds(ids) {
  if (!ids.length) return 0;
  const idSet = new Set(ids.map(Number));
  const rows = readRows();
  const next = rows.filter((row) => !idSet.has(Number(row.id)));
  const deleted = rows.length - next.length;
  writeRows(next);
  return deleted;
}

async function deleteAllHistory() {
  const rows = readRows();
  writeRows([]);
  return rows.length;
}

module.exports = {
  ensureSchema,
  listHistory,
  createHistoryItem,
  deleteHistoryByIds,
  deleteAllHistory,
  rowToItem,
};
