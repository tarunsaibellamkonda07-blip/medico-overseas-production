const crypto = require('crypto');
const scrypt = (password, salt) => new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key)));
async function hashPassword(password) { const salt = crypto.randomBytes(16).toString('hex'); const key = await scrypt(password, salt); return `scrypt:${salt}:${key.toString('hex')}`; }
async function verifyPassword(password, stored) { const [algorithm, salt, expectedHex] = String(stored || '').split(':'); if (algorithm !== 'scrypt' || !salt || !expectedHex) return false; const actual = await scrypt(password, salt); const expected = Buffer.from(expectedHex, 'hex'); return actual.length === expected.length && crypto.timingSafeEqual(actual, expected); }
module.exports = { hashPassword, verifyPassword };
