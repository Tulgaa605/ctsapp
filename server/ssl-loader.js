const fs = require('fs');
const path = require('path');

const LE_DIR = path.join(__dirname, 'ssl', 'le');
const LE_KEY = path.join(LE_DIR, 'privkey.pem');
const LE_CERT = path.join(LE_DIR, 'fullchain.pem');

function loadHttpsCredentials() {
  if (fs.existsSync(LE_KEY) && fs.existsSync(LE_CERT)) {
    return {
      key: fs.readFileSync(LE_KEY),
      cert: fs.readFileSync(LE_CERT),
      source: 'letsencrypt',
    };
  }

  const keyPath = process.env.SSL_KEY_PATH || path.join(__dirname, 'ssl', 'key.pem');
  const certPath = process.env.SSL_CERT_PATH || path.join(__dirname, 'ssl', 'cert.pem');

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    throw new Error(
      'SSL certificate not found. Run: npm run ssl:letsencrypt (domain) or npm run ssl:generate (dev only)'
    );
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    source: 'self-signed',
  };
}

module.exports = { loadHttpsCredentials, LE_DIR, LE_KEY, LE_CERT };
