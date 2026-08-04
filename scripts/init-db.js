require('dotenv').config();
const { sequelize, Admin } = require('../src/db');
const { hashPassword } = require('../src/password');
(async () => {
  try {
    await sequelize.authenticate(); await sequelize.sync({ alter: false });
    const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase(); const password = String(process.env.ADMIN_PASSWORD || '');
    if (!email || password.length < 10) throw new Error('Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 10 characters in .env');
    const passwordHash = await hashPassword(password);
    const [admin, created] = await Admin.findOrCreate({ where: { email }, defaults: { name: process.env.ADMIN_NAME || 'Administrator', passwordHash } });
    if (!created) await admin.update({ name: process.env.ADMIN_NAME || admin.name, passwordHash, active: true });
    console.log('Database initialized and administrator account is ready.');
  } catch (error) { console.error('Database initialization failed:', error.message); process.exitCode = 1; }
  finally { await sequelize.close(); }
})();
