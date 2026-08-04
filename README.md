# Medico Overseas — Production Full-Stack Website

Stack: HTML/CSS/JavaScript, Node.js, Express, MySQL, Sequelize, secure server-side sessions, scrypt password hashing and optional SMTP email notifications.

## What was fixed

- Every public form now has correct `name` fields and sends data to `/api/enquiries`.
- Enquiries are stored in MySQL, not JSON files.
- Admin passwords are securely scrypt-hashed in the database.
- Admin sessions are stored in MySQL and use HttpOnly cookies.
- Admin dashboard supports search, status filtering, notes, deletion and CSV export.
- Blog posts can be created as drafts or published.
- Validation, rate limiting, security headers and compressed responses are enabled.
- SMTP notification support is included.

## Windows setup — easiest method with Docker Desktop

1. Install Node.js LTS and Docker Desktop.
2. Open this project folder in VS Code.
3. Copy `.env.example` to `.env`.
4. Change `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, database passwords and company contact values.
5. Ensure the `DB_PASSWORD` in `.env` matches `MYSQL_PASSWORD` in `docker-compose.yml`.
6. Run:

```cmd
docker compose up -d
npm install
npm run db:init
npm start
```

7. Website: `http://localhost:3000`
8. Admin: `http://localhost:3000/admin`
9. Health check: `http://localhost:3000/api/health`

## Without Docker

Install MySQL 8, run `database/schema.sql` as a MySQL administrator, update the DB settings in `.env`, and then run:

```cmd
npm install
npm run db:init
npm start
```

## Required production configuration

- Set `NODE_ENV=production`.
- Set `APP_URL` to the HTTPS domain.
- Set `TRUST_PROXY=1` when deployed behind Render, Railway, Nginx or another reverse proxy.
- Use a managed MySQL database with backups.
- Use a random `SESSION_SECRET` of at least 32 characters.
- Replace all placeholder company contact information and WhatsApp links.
- Configure SMTP variables to receive enquiry emails.
- Use SSL/HTTPS and never commit `.env` to GitHub.

## SMTP example using Gmail

Use a Google App Password, not the normal Gmail password.

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=youraddress@gmail.com
SMTP_PASS=your-16-character-app-password
MAIL_FROM=Medico Overseas <youraddress@gmail.com>
MAIL_TO=company-inbox@example.com
```

## Database tables

- `admins`: administrator accounts and hashed passwords
- `enquiries`: student enquiry records, status and internal notes
- `blogs`: blog content and publication state
- `admin_sessions`: secure admin sessions

## Deployment

The project works on Node.js hosting such as Render, Railway, a VPS or a server with Node.js. Connect the hosting service to a managed MySQL database, add all `.env` variables in the hosting dashboard, run `npm run db:init` once, then start with `npm start`.

## Important content warning

Country fees, university recognition, eligibility, duration and exam details in the supplied frontend are placeholders until Medico Overseas provides verified current data. Do not publish those claims as final factual content until reviewed by the company.
