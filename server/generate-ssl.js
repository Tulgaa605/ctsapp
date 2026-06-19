const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

const sslDir = path.join(__dirname, 'ssl');
const keyPath = path.join(sslDir, 'key.pem');
const certPath = path.join(sslDir, 'cert.pem');
const host = process.env.SSL_HOST || '64.119.30.250';

if (!fs.existsSync(sslDir)) {
  fs.mkdirSync(sslDir, { recursive: true });
}

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  console.log('SSL certificate already exists:', certPath);
  process.exit(0);
}

const attrs = [{ name: 'commonName', value: host }];
const pems = selfsigned.generate(attrs, {
  days: 3650,
  keySize: 2048,
  algorithm: 'sha256',
  extensions: [
    {
      name: 'subjectAltName',
      altNames: [{ type: 7, ip: host }],
    },
  ],
});

fs.writeFileSync(keyPath, pems.private, 'utf8');
fs.writeFileSync(certPath, pems.cert, 'utf8');

console.log(`SSL certificate created for ${host}`);
console.log('  Key :', keyPath);
console.log('  Cert:', certPath);
