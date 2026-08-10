require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const slugify = require('slugify');
const { Op } = require('sequelize');
const { sequelize, Admin, Enquiry, Blog, AdminSession } = require('./src/db');
const { verifyPassword } = require('./src/password');
const { sendEnquiryNotification } = require('./src/mailer');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
if (String(process.env.TRUST_PROXY) === '1') app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));

function parseCookies(req) { return Object.fromEntries(String(req.headers.cookie || '').split(';').filter(Boolean).map(part => { const i = part.indexOf('='); return [decodeURIComponent(part.slice(0,i).trim()), decodeURIComponent(part.slice(i+1).trim())]; })); }
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
async function currentAdmin(req) {
  const token = parseCookies(req).medico_session; if (!token) return null;
  const row = await AdminSession.findOne({ where: { tokenHash: tokenHash(token), expiresAt: { [Op.gt]: new Date() } } });
  if (!row) return null; return Admin.findOne({ where: { id: row.adminId, active: true } });
}

const enquiryLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many submissions. Please try again after 15 minutes.' } });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many login attempts. Please try again later.' } });

const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const validEmail = value => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validPhone = value => /^[0-9+()\-\s]{7,20}$/.test(value);
const adminOnly = async (req, res, next) => { try { const admin = await currentAdmin(req); if (!admin) return res.status(401).json({ message: 'Administrator login required.' }); req.admin = admin; next(); } catch (error) { next(error); } };
const csvEscape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;

app.get('/api/health', async (req, res) => {
  try { await sequelize.authenticate(); res.json({ status: 'ok', database: 'connected', time: new Date().toISOString() }); }
  catch { res.status(503).json({ status: 'error', database: 'disconnected' }); }
});

app.post('/api/enquiries', enquiryLimiter, async (req, res, next) => {
  try {
    const data = {
      name: clean(req.body.name, 100), phone: clean(req.body.phone, 25), email: clean(req.body.email, 190),
      city: clean(req.body.city, 100), interestedCountry: clean(req.body.interestedCountry, 100),
      neetScore: clean(req.body.neetScore, 20), message: clean(req.body.message, 2000),
      source: clean(req.body.source || req.get('referer'), 100), ipAddress: clean(req.ip, 64), userAgent: clean(req.get('user-agent'), 500)
    };
    if (!data.name || !data.phone) return res.status(400).json({ message: 'Name and phone number are required.' });
    if (!validPhone(data.phone)) return res.status(400).json({ message: 'Enter a valid phone number.' });
    if (!validEmail(data.email)) return res.status(400).json({ message: 'Enter a valid email address.' });
    const enquiry = await Enquiry.create(data);
    sendEnquiryNotification(enquiry.toJSON()).catch(error => console.error('Email notification failed:', error.message));
    res.status(201).json({ message: 'Thank you. Your enquiry was submitted successfully.', id: enquiry.id });
  } catch (error) { next(error); }
});

app.post('/api/admin/login', loginLimiter, async (req, res, next) => {
  try {
    const email = clean(req.body.email, 190).toLowerCase();
    const admin = await Admin.findOne({ where: { email, active: true } });
    if (!admin || !(await verifyPassword(String(req.body.password || ''), admin.passwordHash))) return res.status(401).json({ message: 'Invalid email or password.' });
    const token = crypto.randomBytes(32).toString('hex');
    await AdminSession.create({ tokenHash: tokenHash(token), adminId: admin.id, expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000) });
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `medico_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure}`);
    res.json({ message: 'Login successful.', email: admin.email });
  } catch (error) { next(error); }
});
app.post('/api/admin/logout', async (req, res, next) => { try { const token = parseCookies(req).medico_session; if (token) await AdminSession.destroy({ where: { tokenHash: tokenHash(token) } }); res.setHeader('Set-Cookie','medico_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); res.json({ message: 'Logged out.' }); } catch (error) { next(error); } });
app.get('/api/admin/session', async (req, res, next) => { try { const admin = await currentAdmin(req); res.json({ authenticated: Boolean(admin), email: admin?.email || null }); } catch (error) { next(error); } });

app.get('/api/blogs', async (req, res, next) => {
  try { res.json(await Blog.findAll({ where: { published: true }, order: [['publishedAt','DESC'],['createdAt','DESC']] })); }
  catch (error) { next(error); }
});
app.get('/api/blogs/:slug', async (req, res, next) => {
  try { const post = await Blog.findOne({ where: { slug: req.params.slug, published: true } }); post ? res.json(post) : res.status(404).json({ message: 'Post not found.' }); }
  catch (error) { next(error); }
});

app.get('/api/admin/enquiries', adminOnly, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1)); const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
    const where = {}; const q = clean(req.query.q, 100); const status = clean(req.query.status, 20);
    if (status && ['new','contacted','qualified','closed'].includes(status)) where.status = status;
    if (q) where[Op.or] = ['name','phone','email','city','interestedCountry'].map(field => ({ [field]: { [Op.like]: `%${q}%` } }));
    const result = await Enquiry.findAndCountAll({ where, order: [['createdAt','DESC']], limit, offset: (page - 1) * limit });
    res.json({ rows: result.rows, total: result.count, page, pages: Math.ceil(result.count / limit) });
  } catch (error) { next(error); }
});
app.get('/api/admin/enquiries/export.csv', adminOnly, async (req, res, next) => {
  try {
    const rows = await Enquiry.findAll({ order: [['createdAt','DESC']] });
    const headers = ['ID','Created','Name','Phone','Email','City','Country','NEET Score','Status','Message','Notes','Source'];
    const lines = [headers.map(csvEscape).join(',')].concat(rows.map(x => [x.id,x.createdAt,x.name,x.phone,x.email,x.city,x.interestedCountry,x.neetScore,x.status,x.message,x.notes,x.source].map(csvEscape).join(',')));
    res.set({ 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':`attachment; filename="medico-enquiries-${new Date().toISOString().slice(0,10)}.csv"` });
    res.send('\uFEFF' + lines.join('\r\n'));
  } catch (error) { next(error); }
});
app.patch('/api/admin/enquiries/:id', adminOnly, async (req, res, next) => {
  try {
    const enquiry = await Enquiry.findByPk(req.params.id); if (!enquiry) return res.status(404).json({ message: 'Enquiry not found.' });
    const updates = { notes: clean(req.body.notes, 3000) };
    if (['new','contacted','qualified','closed'].includes(req.body.status)) updates.status = req.body.status;
    await enquiry.update(updates); res.json(enquiry);
  } catch (error) { next(error); }
});
app.delete('/api/admin/enquiries/:id', adminOnly, async (req, res, next) => {
  try { const count = await Enquiry.destroy({ where: { id: req.params.id } }); count ? res.json({ message: 'Enquiry deleted.' }) : res.status(404).json({ message: 'Enquiry not found.' }); }
  catch (error) { next(error); }
});

app.get('/api/admin/blogs', adminOnly, async (req, res, next) => { try { res.json(await Blog.findAll({ order: [['createdAt','DESC']] })); } catch (error) { next(error); } });
app.post('/api/admin/blogs', adminOnly, async (req, res, next) => {
  try {
    const title = clean(req.body.title, 220); if (!title) return res.status(400).json({ message: 'Title is required.' });
    let slug = clean(req.body.slug || slugify(title, { lower: true, strict: true }), 240);
    if (await Blog.count({ where: { slug } })) slug += '-' + crypto.randomBytes(3).toString('hex');
    const published = Boolean(req.body.published);
    const post = await Blog.create({ title, slug, excerpt: clean(req.body.excerpt, 1200), category: clean(req.body.category || 'general', 60), content: clean(req.body.content, 100000), featuredImage: clean(req.body.featuredImage, 500), published, publishedAt: published ? new Date() : null });
    res.status(201).json(post);
  } catch (error) { next(error); }
});
app.put('/api/admin/blogs/:id', adminOnly, async (req, res, next) => {
  try {
    const post = await Blog.findByPk(req.params.id); if (!post) return res.status(404).json({ message: 'Post not found.' });
    const published = Boolean(req.body.published);
    await post.update({ title: clean(req.body.title || post.title, 220), slug: clean(req.body.slug || post.slug, 240), excerpt: clean(req.body.excerpt, 1200), category: clean(req.body.category || 'general', 60), content: clean(req.body.content, 100000), featuredImage: clean(req.body.featuredImage, 500), published, publishedAt: published && !post.publishedAt ? new Date() : post.publishedAt });
    res.json(post);
  } catch (error) { next(error); }
});
app.delete('/api/admin/blogs/:id', adminOnly, async (req, res, next) => { try { const count = await Blog.destroy({ where: { id: req.params.id } }); count ? res.json({ message: 'Post deleted.' }) : res.status(404).json({ message: 'Post not found.' }); } catch (error) { next(error); } });

app.use(express.static(PUBLIC, { maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0, extensions: ['html'] }));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, '404.html')));
app.use((error, req, res, next) => { console.error(error); res.status(500).json({ message: process.env.NODE_ENV === 'production' ? 'Internal server error.' : error.message }); });

async function start() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) console.warn('WARNING: Set a strong SESSION_SECRET with at least 32 characters.');
  await sequelize.authenticate();
  await sequelize.sync();
  app.listen(PORT, () => console.log(`Medico Overseas running at http://localhost:${PORT}`));
}
/* =========================================
   MEDICO AI CHAT
========================================= */

/* Open Chat */

aiChatButton.addEventListener("click", () => {
  aiChatWindow.classList.add("active");
  aiChatInput.focus();
});


/* Close Chat */

aiChatClose.addEventListener("click", () => {
  aiChatWindow.classList.remove("active");
});


/* Send on Enter */

aiChatInput.addEventListener("keydown", (event) => {

  if (event.key === "Enter") {
    sendAIMessage();
  }

});


/* Send Button */

aiSendButton.addEventListener("click", sendAIMessage);


/* Send Message */

async function sendAIMessage() {

  const message = aiChatInput.value.trim();

  if (!message) {
    return;
  }


  /* Display user message */

  const userMessage = document.createElement("div");

  userMessage.className = "user-message";

  userMessage.innerHTML = `
    <div class="user-bubble">
      ${escapeHTML(message)}
    </div>
  `;

  aiChatMessages.appendChild(userMessage);


  /* Clear input */

  aiChatInput.value = "";


  /* Scroll */

  aiChatMessages.scrollTop = aiChatMessages.scrollHeight;


  /* Loading */

  const loadingMessage = document.createElement("div");

  loadingMessage.className = "ai-message";

  loadingMessage.innerHTML = `
    <div class="ai-avatar">
      <i class="fas fa-robot"></i>
    </div>

    <div class="ai-bubble ai-loading">
      Medico AI is thinking...
    </div>
  `;

  aiChatMessages.appendChild(loadingMessage);

  aiChatMessages.scrollTop = aiChatMessages.scrollHeight;


  try {

    const response = await fetch(
      "http://localhost:5000/api/chat",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          message: message
        })
      }
    );


    const data = await response.json();


    /* Remove loading */

    loadingMessage.remove();


    /* AI response */

    const aiMessage = document.createElement("div");

    aiMessage.className = "ai-message";

    aiMessage.innerHTML = `
      <div class="ai-avatar">
        <i class="fas fa-robot"></i>
      </div>

      <div class="ai-bubble">
        ${formatAIResponse(data.reply || data.error)}
      </div>
    `;

    aiChatMessages.appendChild(aiMessage);


  } catch (error) {

    loadingMessage.remove();

    const errorMessage = document.createElement("div");

    errorMessage.className = "ai-message";

    errorMessage.innerHTML = `
      <div class="ai-avatar">
        <i class="fas fa-robot"></i>
      </div>

      <div class="ai-bubble">
        ❌ Unable to connect to Medico AI server.
        <br><br>
        Please make sure the Node.js server is running.
      </div>
    `;

    aiChatMessages.appendChild(errorMessage);

    console.error("AI connection error:", error);

  }


  aiChatMessages.scrollTop = aiChatMessages.scrollHeight;

}


/* Prevent HTML injection */

function escapeHTML(text) {

  const div = document.createElement("div");

  div.textContent = text;

  return div.innerHTML;

}


/* Basic response formatting */

function formatAIResponse(text) {

  if (!text) {
    return "Sorry, I couldn't generate a response.";
  }

  return escapeHTML(text)
    .replace(/\n/g, "<br>");

}
