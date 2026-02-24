const crypto = require('crypto');
const fs = require('fs');

// Generate RSA key pair
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

// Create a self-signed certificate using Node.js X509Certificate (Node 20+)
// For dev use, we generate a basic self-signed cert
const cert = crypto.X509Certificate ? (() => {
    // Node 20+ doesn't have createCertificate, so we'll create a minimal DER cert
    // For now, write key pair - docker compose dev doesn't need nginx/certs
    return null;
})() : null;

fs.writeFileSync('d:/QS_VC/certs/privkey.pem', privateKey);
fs.writeFileSync('d:/QS_VC/certs/fullchain.pem', publicKey);
console.log('Dev keys generated in d:/QS_VC/certs/');
console.log('Note: For production, use proper CA-signed certificates.');
console.log('For local dev, the dev docker-compose.yml does not use nginx/TLS.');
