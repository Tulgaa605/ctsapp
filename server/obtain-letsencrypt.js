require('dotenv').config();

const fs = require('fs');
const http = require('http');
const path = require('path');
const { execSync } = require('child_process');
const acme = require('acme-client');
const { LE_DIR, LE_KEY, LE_CERT } = require('./ssl-loader');

const email = (process.env.LETSENCRYPT_EMAIL || '').trim();
const useStaging = process.env.LE_STAGING === '1';

function isIp(value) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
}

function ipToSslip(ip) {
  return `${ip.replace(/\./g, '-')}.sslip.io`;
}

function freePort80OnWindows() {
  if (process.platform !== 'win32') return () => {};
  console.log('Windows: порт 80 чөлөөлж байна (net stop http)...');
  try {
    execSync('net stop http /y', { stdio: 'inherit' });
  } catch (error) {
    console.warn('net stop http амжилтгүй (Admin эрх шаардлагатай):', error.message);
  }
  return () => {
    try {
      execSync('net start http', { stdio: 'inherit' });
      console.log('HTTP.sys дахин асаалаа');
    } catch (error) {
      console.warn('net start http амжилтгүй:', error.message);
    }
  };
}

async function obtainWithHttp01(client, host) {
  const challengeResponses = new Map();
  let httpServer = null;
  let restorePort80 = () => {};

  const startServer = () => new Promise((resolve, reject) => {
    restorePort80 = freePort80OnWindows();
    httpServer = http.createServer((req, res) => {
      if (!req.url?.startsWith('/.well-known/acme-challenge/')) {
        res.writeHead(404);
        res.end();
        return;
      }
      const token = req.url.split('/').pop();
      const body = challengeResponses.get(token);
      if (!body) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(body);
    });
    httpServer.once('error', reject);
    httpServer.listen(80, '0.0.0.0', resolve);
  });

  const stopServer = () => {
    if (httpServer) {
      httpServer.close();
      httpServer = null;
    }
    restorePort80();
  };

  const [privateKey, csr] = await acme.crypto.createCsr({
    commonName: host,
    altNames: [host],
  });

  await startServer();

  try {
    console.log('HTTP-01 (порт 80) challenge...');
    const certificate = await client.auto({
      csr,
      email,
      termsOfServiceAgreed: true,
      challengePriority: ['http-01'],
      skipChallengeVerification: true,
      challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
        if (challenge.type === 'http-01') {
          challengeResponses.set(challenge.token, keyAuthorization);
        }
      },
      challengeRemoveFn: async (_authz, challenge) => {
        challengeResponses.delete(challenge.token);
      },
    });

    return { privateKey, certificate };
  } finally {
    stopServer();
  }
}

async function main() {
  let host = (process.env.SSL_DOMAIN || '').trim();
  if (!host && process.env.PUBLIC_HOST) {
    host = ipToSslip(process.env.PUBLIC_HOST.trim());
    console.log(`SSL_DOMAIN автоматаар: ${host}`);
  }
  if (!host) throw new Error('SSL_DOMAIN эсвэл PUBLIC_HOST тохируулна уу');
  if (!email) throw new Error('LETSENCRYPT_EMAIL тохируулна уу');
  if (isIp(host)) {
    throw new Error(`SSL_DOMAIN=${ipToSslip(host)} ашиглана (sslip.io)`);
  }

  if (fs.existsSync(LE_KEY) && fs.existsSync(LE_CERT) && process.env.FORCE_SSL_RENEW !== '1') {
    console.log('Let\'s Encrypt сертификат аль хэдийн байна:', LE_CERT);
    console.log(`Нээнэ: https://${host}:${process.env.PORT || 8081}`);
    return;
  }

  fs.mkdirSync(LE_DIR, { recursive: true });
  const accountKeyPath = path.join(LE_DIR, 'account.key');
  const accountKey = fs.existsSync(accountKeyPath)
    ? fs.readFileSync(accountKeyPath)
    : await acme.crypto.createPrivateRsaKey();

  if (!fs.existsSync(accountKeyPath)) {
    fs.writeFileSync(accountKeyPath, accountKey);
  }

  const client = new acme.Client({
    directoryUrl: useStaging
      ? acme.directory.letsencrypt.staging
      : acme.directory.letsencrypt.production,
    accountKey,
  });

  console.log(`Let's Encrypt (${useStaging ? 'staging' : 'production'})`);
  console.log(`Домэйн: ${host}`);

  const { privateKey, certificate } = await obtainWithHttp01(client, host);

  fs.writeFileSync(LE_KEY, privateKey);
  fs.writeFileSync(LE_CERT, certificate);

  console.log('\nАмжилттай!');
  console.log('Key :', LE_KEY);
  console.log('Cert:', LE_CERT);
  console.log(`\nКамертай нээнэ: https://${host}:${process.env.PORT || 8081}`);
}

main().catch((error) => {
  console.error('ssl:letsencrypt failed:', error.message);
  process.exit(1);
});
