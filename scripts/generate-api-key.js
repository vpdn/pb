#!/usr/bin/env node

const crypto = require('crypto');

function generateApiKey() {
  const randomBytes = crypto.randomBytes(24);
  const key = randomBytes.toString('base64')
    .replace(/\+/g, '')
    .replace(/\//g, '')
    .replace(/=/g, '');
  
  return `pb_${key}`;
}

const apiKey = generateApiKey();
console.log(`Generated API Key: ${apiKey}`);
console.log(`\nTo add this key to your database, run:`);
console.log(`npx wrangler d1 execute pb-db --command="INSERT INTO api_keys (key, name) VALUES ('${apiKey}', 'YOUR_KEY_NAME')"`);