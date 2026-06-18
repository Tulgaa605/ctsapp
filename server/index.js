const express = require('express');
const cors = require('cors');
require('dotenv').config();

const {
  ensureSchema,
  listHistory,
  createHistoryItem,
  deleteHistoryByIds,
  deleteAllHistory,
} = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/history', async (req, res) => {
  try {
    const year = req.query.year ? Number(req.query.year) : undefined;
    const month = req.query.month ? Number(req.query.month) : undefined;
    const items = await listHistory({ year, month });
    res.json(items);
  } catch (error) {
    console.error('GET /api/history', error);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

app.post('/api/history', async (req, res) => {
  try {
    const item = req.body;
    if (!item?.assetCode || !item?.serialNumber || !item?.raw) {
      return res.status(400).json({ error: 'assetCode, serialNumber, raw are required' });
    }

    const saved = await createHistoryItem(item);
    res.status(201).json(saved);
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Duplicate asset already saved' });
    }
    console.error('POST /api/history', error);
    res.status(500).json({ error: 'Failed to save history' });
  }
});

app.delete('/api/history', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    const deleted = await deleteHistoryByIds(ids);
    res.json({ deleted });
  } catch (error) {
    console.error('DELETE /api/history', error);
    res.status(500).json({ error: 'Failed to delete history' });
  }
});

app.delete('/api/history/all', async (_req, res) => {
  try {
    const deleted = await deleteAllHistory();
    res.json({ deleted });
  } catch (error) {
    console.error('DELETE /api/history/all', error);
    res.status(500).json({ error: 'Failed to delete all history' });
  }
});

async function proxyCts(path, req, res) {
  try {
    const payload = typeof req.body === 'string' ? req.body : req.body;
    const response = await fetch(`https://ctsystem.mn${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    res.status(response.status).send(text);
  } catch (error) {
    console.error(`CTS proxy ${path}`, error);
    res.status(502).json({ error: 'CTS proxy failed' });
  }
}

app.post('/api/cts/asset', (req, res) => proxyCts('/api/asset', req, res));
app.post('/api/cts/details', (req, res) => proxyCts('/api/details', req, res));

async function start() {
  await ensureSchema();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CTS API running on http://0.0.0.0:${PORT}`);
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
