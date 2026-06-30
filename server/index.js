const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const {
  ensureSchema,
  listHistory,
  createHistoryItem,
  deleteHistoryByIds,
  deleteAllHistory,
} = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 8081);

app.use(cors());

/** CTS proxy — QR string илгээлт (JSON string эсвэл plain text) */
const ctsTextBody = express.text({ type: '*/*', limit: '2mb' });
const ctsJsonBody = express.json({ limit: '2mb' });

const CTS_PROXY_BASE = 'https://ctsystem.mn';

function normalizeCtsForwardBody(body) {
  if (body == null) return '""';
  if (typeof body === 'object') return JSON.stringify(body);
  const trimmed = String(body).trim();
  if (!trimmed) return '""';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  if (trimmed.startsWith('"')) {
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      return JSON.stringify(trimmed);
    }
  }
  return JSON.stringify(trimmed);
}

async function proxyCts(path, req, res) {
  try {
    const forwardBody = normalizeCtsForwardBody(req.body);
    const response = await fetch(`${CTS_PROXY_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: forwardBody,
    });
    const text = await response.text();
    res.status(response.status).send(text);
  } catch (error) {
    console.error(`CTS proxy ${path}`, error);
    res.status(502).json({ error: 'CTS proxy failed' });
  }
}

app.post('/api/cts/asset', ctsTextBody, (req, res) => proxyCts('/api/asset', req, res));
app.post('/api/cts/details', ctsTextBody, (req, res) => proxyCts('/api/details', req, res));
app.post('/api/cts/assetAll', ctsJsonBody, (req, res) => proxyCts('/api/assetAll', req, res));

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
    console.log('POST /api/history', item?.assetCode, item?.serialNumber);
    if (!item?.assetCode || !item?.serialNumber || !item?.raw) {
      return res.status(400).json({ error: 'assetCode, serialNumber, raw are required' });
    }

    const saved = await createHistoryItem(item);
    console.log('POST /api/history saved id:', saved.id);
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

const webBuildPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(webBuildPath)) {
  app.use(express.static(webBuildPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') return next();
    res.sendFile(path.join(webBuildPath, 'index.html'));
  });
}

const { loadHttpsCredentials } = require('./ssl-loader');

async function start() {
  await ensureSchema();
  const publicHost = process.env.SSL_DOMAIN || process.env.PUBLIC_HOST || '64.119.30.250';
  const useHttp = process.env.SSL_DISABLED === '1' || process.env.SSL_DISABLED === 'true';

  if (useHttp) {
    http.createServer(app).listen(PORT, '0.0.0.0', () => {
      console.log(`CTS API running on http://${publicHost}:${PORT}`);
      console.log('HTTP горим — анхааруулгагүй ачаална (хаягийн мөрөнд "Not secure" байж болно)');
    });
    return;
  }

  const { key, cert, source } = loadHttpsCredentials();

  https.createServer({ key, cert }, app).listen(PORT, '0.0.0.0', () => {
    console.log(`CTS API running on https://${publicHost}:${PORT} (SSL: ${source})`);
    if (source === 'self-signed') {
      console.warn('WARNING: Self-signed — "Not private" гарна. npm run ssl:letsencrypt эсвэл SSL_DISABLED=1');
    }
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
