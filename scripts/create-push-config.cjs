const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const webpush = require('web-push');
const target = path.join(__dirname, '..', '.env.push');
if (fs.existsSync(target)) { console.error('.env.push already exists. Preserve its keys for existing device subscriptions.'); process.exit(1); }
const keys = webpush.generateVAPIDKeys();
fs.writeFileSync(target, `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=https://smart-companion-nine.vercel.app/\nCRON_SECRET=${crypto.randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
console.log('Created ignored .env.push. Add its values privately to the RailPulse server environment. No secrets were printed.');
