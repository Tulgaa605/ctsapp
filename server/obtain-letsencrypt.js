require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const readline = require('readline');
const acme = require('acme-client');
const { LE_DIR, LE_KEY, LE_CERT } = require('./ssl-loader');

const email = (process.env.LETSENCRYPT_EMAIL || '').trim();
const useStaging = process.env.LE_STAGING === '1';
const useDns = process.env.SSL_DNS_MANUAL === '1' || process.env.SSL_DNS_MANUAL === 'true';

function isIp(value) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function waitForDns() {
  console.log('\nDNS TXT бичлэг нэмсний дараа 1-5 минут хүлээгээд Enter дарна уу...');
  await ask('Бэлэн болсон уу? (Enter): ');
}

async function runHttpChallenge(client, order) {
  const challengeResponses = new Map();
  const server = http.createServer((req, res) => {
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

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(80, '0.0.0.0', resolve);
  });

  try {
    const authorizations = await client.getAuthorizations(order);
    for (const authz of authorizations) {
      const challenge = authz.challenges.find((item) => item.type === 'http-01');
      if (!challenge) throw new Error('http-01 challenge not available');

      const keyAuthorization = await client.getChallengeKeyAuthorization(challenge.token);
      challengeResponses.set(challenge.token, keyAuthorization);

      await client.verifyChallenge(authz, challenge);
      await client.completeChallenge(challenge);
      await client.waitForValidStatus(challenge);
    }
  } finally {
    server.close();
  }
}

async function runDnsChallenge(client, order, host) {
  const authorizations = await client.getAuthorizations(order);
  for (const authz of authorizations) {
    const challenge = authz.challenges.find((item) => item.type === 'dns-01');
    if (!challenge) throw new Error('dns-01 challenge not available');

    const keyAuthorization = await client.getChallengeKeyAuthorization(challenge.token);
    const record = crypto.createHash('sha256').update(keyAuthorization).digest('base64url');

    console.log('\n=== DNS TXT бичлэг нэмнэ үү ===');
    console.log(`Нэр : _acme-challenge.${host}`);
    console.log(`Утга: ${record}`);
    console.log('================================\n');

    await waitForDns();

    await client.verifyChallenge(authz, challenge);
    await client.completeChallenge(challenge);
    await client.waitForValidStatus(challenge);
  }
}

function ipToSslip(ip) {
  return `${ip.replace(/\./g, '-')}.sslip.io`;
}

async function main() {
  let host = (process.env.SSL_DOMAIN || '').trim();
  if (!host && process.env.PUBLIC_HOST) {
    host = ipToSslip(process.env.PUBLIC_HOST.trim());
    console.log(`SSL_DOMAIN автоматаар: ${host}`);
  }
  if (!host) {
    throw new Error('SSL_DOMAIN эсвэл PUBLIC_HOST тохируулна уу');
  }
  if (!email) {
    throw new Error('LETSENCRYPT_EMAIL тохируулна уу (жишээ: admin@example.com)');
  }
  if (isIp(host)) {
    throw new Error(
      `IP биш домэйн хэрэгтэй. Жишээ: SSL_DOMAIN=${ipToSslip(host)} (sslip.io — DNS тохируулахгүй)`
    );
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

  await client.createAccount({
    termsOfServiceAgreed: true,
    contact: [`mailto:${email}`],
  });

  const [privateKey, csr] = await acme.crypto.createCsr({
    commonName: host,
    altNames: [host],
  });

  const order = await client.createOrder({
    identifiers: [{ type: 'dns', value: host }],
  });

  if (useDns) {
    await runDnsChallenge(client, order, host);
  } else {
    try {
      console.log('HTTP-01 (порт 80) оролдож байна...');
      await runHttpChallenge(client, order);
    } catch (error) {
      console.warn('HTTP-01 амжилтгүй:', error.message);
      console.log('DNS-01 горим руу шилжиж байна...');
      await runDnsChallenge(client, order, host);
    }
  }

  const certificate = await client.getCertificate(order);
  fs.writeFileSync(LE_KEY, privateKey);
  fs.writeFileSync(LE_CERT, certificate);

  console.log('\nАмжилттай!');
  console.log('Key :', LE_KEY);
  console.log('Cert:', LE_CERT);
  console.log(`\nОдоо нээнэ: https://${host}:${process.env.PORT || 8081}`);
  console.log('(IP биш энэ домэйнээр нээнэ үү)');
}

main().catch((error) => {
  console.error('ssl:letsencrypt failed:', error.message);
  process.exit(1);
});
