const { hashPassword } = require('./src/password');

(async () => {
  const password = "Admin@123";
  const hash = await hashPassword(password);
  console.log(hash);
})();