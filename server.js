require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const slugify = require('slugify');
const { Op } = require('sequelize');
const { GoogleGenAI } = require('@google/genai');

const {
  sequelize,
  Admin,
  Enquiry,
  Blog,
  AdminSession
} = require('./src/db');

const { verifyPassword } = require('./src/password');
const { sendEnquiryNotification } = require('./src/mailer');


/* =========================================================
   APP CONFIGURATION
========================================================= */

const app = express();

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');

if (String(process.env.TRUST_PROXY) === '1') {
  app.set('trust proxy', 1);
}

app.disable('x-powered-by');


/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: {
      policy: 'cross-origin'
    }
  })
);

app.use(compression());

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(
  express.json({
    limit: '200kb'
  })
);

app.use(
  express.urlencoded({
    extended: false,
    limit: '200kb'
  })
);


/* =========================================================
   GEMINI AI CONFIGURATION
========================================================= */

let ai = null;

if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });

  console.log('Gemini AI configured successfully.');
} else {
  console.warn(
    'WARNING: GEMINI_API_KEY is not configured. AI chat will be unavailable.'
  );
}


/* =========================================================
   HELPERS
========================================================= */

function parseCookies(req) {
  const cookieHeader = String(req.headers.cookie || '');

  if (!cookieHeader) {
    return {};
  }

  return Object.fromEntries(
    cookieHeader
      .split(';')
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');

        if (index === -1) {
          return ['', ''];
        }

        const key = decodeURIComponent(
          part.slice(0, index).trim()
        );

        const value = decodeURIComponent(
          part.slice(index + 1).trim()
        );

        return [key, value];
      })
  );
}


const tokenHash = (token) =>
  crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');


async function currentAdmin(req) {
  const cookies = parseCookies(req);

  const token = cookies.medico_session;

  if (!token) {
    return null;
  }

  const session = await AdminSession.findOne({
    where: {
      tokenHash: tokenHash(token),
      expiresAt: {
        [Op.gt]: new Date()
      }
    }
  });

  if (!session) {
    return null;
  }

  return Admin.findOne({
    where: {
      id: session.adminId,
      active: true
    }
  });
}


const clean = (value, max = 500) =>
  String(value ?? '')
    .trim()
    .slice(0, max);


const validEmail = (value) =>
  !value ||
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);


const validPhone = (value) =>
  /^[0-9+()\-\s]{7,20}$/.test(value);


const csvEscape = (value) =>
  `"${String(value ?? '').replace(/"/g, '""')}"`;


/* =========================================================
   RATE LIMITERS
========================================================= */

const enquiryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message:
      'Too many submissions. Please try again after 15 minutes.'
  }
});


const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message:
      'Too many login attempts. Please try again later.'
  }
});


const aiChatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error:
      'Too many AI requests. Please try again later.'
  }
});


/* =========================================================
   ADMIN AUTH MIDDLEWARE
========================================================= */

const adminOnly = async (req, res, next) => {
  try {
    const admin = await currentAdmin(req);

    if (!admin) {
      return res.status(401).json({
        message: 'Administrator login required.'
      });
    }

    req.admin = admin;

    next();
  } catch (error) {
    next(error);
  }
};


/* =========================================================
   BASIC ROUTE
========================================================= */

app.get('/api/health', async (req, res) => {
  try {
    await sequelize.authenticate();

    res.json({
      status: 'ok',
      database: 'connected',
      ai: Boolean(ai),
      time: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check error:', error);

    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      ai: Boolean(ai)
    });
  }
});


/* =========================================================
   AI CHAT API
========================================================= */

app.post(
  '/api/chat',
  aiChatLimiter,
  async (req, res) => {
    try {
      const message = String(
        req.body?.message || ''
      ).trim();

      if (!message) {
        return res.status(400).json({
          error: 'Message is required.'
        });
      }

      if (!ai || !process.env.GEMINI_API_KEY) {
        return res.status(503).json({
          error:
            'AI service is not configured. Please configure GEMINI_API_KEY on the server.'
        });
      }

      console.log(
        'AI user message:',
        message
      );

      const response =
        await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text:
                    `You are Medico Overseas AI Assistant.

Help students with:
- MBBS abroad
- Medical universities
- Countries for studying medicine
- Admission process
- NEET-related general guidance
- Documents
- Fees
- Visa information
- Student counselling

Give clear, helpful and concise answers.

Important:
Do not claim to be an official university or government representative.
Do not guarantee admission, visa approval, rankings, fees or eligibility.
For medical/legal/visa matters, advise the student to verify current requirements with the relevant official authority.

Student question:
${message}`
                }
              ]
            }
          ]
        });

      const reply =
        response?.text ||
        'Sorry, I could not generate a response.';

      console.log('Gemini response received.');

      return res.json({
        reply
      });

    } catch (error) {
      console.error(
        'Gemini Error:',
        error
      );

      return res.status(500).json({
        error:
          'AI assistant could not process your request.'
      });
    }
  }
);


/* =========================================================
   ENQUIRIES
========================================================= */

app.post(
  '/api/enquiries',
  enquiryLimiter,
  async (req, res, next) => {
    try {
      const data = {
        name: clean(
          req.body.name,
          100
        ),

        phone: clean(
          req.body.phone,
          25
        ),

        email: clean(
          req.body.email,
          190
        ),

        city: clean(
          req.body.city,
          100
        ),

        interestedCountry: clean(
          req.body.interestedCountry,
          100
        ),

        neetScore: clean(
          req.body.neetScore,
          20
        ),

        message: clean(
          req.body.message,
          2000
        ),

        source: clean(
          req.body.source ||
            req.get('referer'),
          100
        ),

        ipAddress: clean(
          req.ip,
          64
        ),

        userAgent: clean(
          req.get('user-agent'),
          500
        )
      };


      if (!data.name || !data.phone) {
        return res.status(400).json({
          message:
            'Name and phone number are required.'
        });
      }


      if (!validPhone(data.phone)) {
        return res.status(400).json({
          message:
            'Enter a valid phone number.'
        });
      }


      if (!validEmail(data.email)) {
        return res.status(400).json({
          message:
            'Enter a valid email address.'
        });
      }


      const enquiry =
        await Enquiry.create(data);


      sendEnquiryNotification(
        enquiry.toJSON()
      ).catch((error) => {
        console.error(
          'Email notification failed:',
          error.message
        );
      });


      return res.status(201).json({
        message:
          'Thank you. Your enquiry was submitted successfully.',
        id: enquiry.id
      });

    } catch (error) {
      next(error);
    }
  }
);


/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post(
  '/api/admin/login',
  loginLimiter,
  async (req, res, next) => {
    try {
      const email = clean(
        req.body.email,
        190
      ).toLowerCase();

      const password = String(
        req.body.password || ''
      );


      const admin =
        await Admin.findOne({
          where: {
            email,
            active: true
          }
        });


      if (
        !admin ||
        !(await verifyPassword(
          password,
          admin.passwordHash
        ))
      ) {
        return res.status(401).json({
          message:
            'Invalid email or password.'
        });
      }


      const token =
        crypto.randomBytes(32).toString(
          'hex'
        );


      await AdminSession.create({
        tokenHash:
          tokenHash(token),

        adminId:
          admin.id,

        expiresAt:
          new Date(
            Date.now() +
              8 * 60 * 60 * 1000
          )
      });


      const secure =
        process.env.NODE_ENV ===
        'production'
          ? '; Secure'
          : '';


      res.setHeader(
        'Set-Cookie',
        `medico_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure}`
      );


      return res.json({
        message:
          'Login successful.',
        email:
          admin.email
      });

    } catch (error) {
      next(error);
    }
  }
);


/* =========================================================
   ADMIN LOGOUT
========================================================= */

app.post(
  '/api/admin/logout',
  async (req, res, next) => {
    try {
      const cookies =
        parseCookies(req);

      const token =
        cookies.medico_session;


      if (token) {
        await AdminSession.destroy({
          where: {
            tokenHash:
              tokenHash(token)
          }
        });
      }


      res.setHeader(
        'Set-Cookie',
        'medico_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
      );


      return res.json({
        message:
          'Logged out.'
      });

    } catch (error) {
      next(error);
    }
  }
);


/* =========================================================
   ADMIN SESSION
========================================================= */

app.get(
  '/api/admin/session',
  async (req, res, next) => {
    try {
      const admin =
        await currentAdmin(req);

      return res.json({
        authenticated:
          Boolean(admin),

        email:
          admin?.email || null
      });

    } catch (error) {
      next(error);
    }
  }
);


/* =========================================================
   PUBLIC BLOGS
========================================================= */

app.get(
  '/api/blogs',
  async (req, res, next) => {
    try {
      const blogs =
        await Blog.findAll({
          where: {
            published: true
          },

          order: [
            [
              'publishedAt',
              'DESC'
            ],

            [
              'createdAt',
              'DESC'
            ]
          ]
        });


      return res.json(blogs);

    } catch (error) {
      next(error);
    }
  }
);


app.get(
  '/api/blogs/:slug',
  async (req, res, next) => {
    try {
      const post =
        await Blog.findOne({
          where: {
            slug:
              req.params.slug,

            published: true
          }
        });


      if (!post) {
        return res.status(404).json({
          message:
            'Post not found.'
        });
      }


      return res.json(post);

    } catch (error) {
      next(error);
    }
  }
);


/* =========================================================
   ADMIN ENQUIRIES
========================================================= */

app.get(
  '/api/admin/enquiries',
  adminOnly,
  async (req, res, next) => {
    try {
      const page =
        Math.max(
          1,
          Number(
            req.query.page || 1
          )
        );


      const limit =
        Math.min(
          100,
          Math.max(
            1,
            Number(
              req.query.limit || 25
            )
          )
        );


      const where = {};


      const q = clean(
        req.query.q,
        100
      );


      const status = clean(
        req.query.status,
        20
      );


      if (
        status &&
        [
          'new',
          'contacted',
          'qualified',
          'closed'
        ].includes(status)
      ) {
        where.status =
          status;
      }


      if (q) {
        where[Op.or] =
          [
            'name',
            'phone',
            'email',
            'city',
            'interestedCountry'
          ].map(
            (field) => ({
              [field]: {
                [Op.like]:
                  `%${q}%`
              }
            })
          );
      }


      const result =
        await Enquiry.findAndCountAll({
          where,

          order: [
            [
              'createdAt',
              'DESC'
            ]
          ],

          limit,

          offset:
            (page - 1) *
            limit
        });


      return res.json({
        rows:
          result.rows,

        total:
          result.count,

        page,

        pages:
          Math.ceil(
            result.count /
              limit
          )
      });

    } catch (error) {
      next(error);
    }
  }
);


/* =========================================================
   EXPORT ENQUIRIES CSV
========================================================= */

app.get(
  '/api/admin/enquiries/export.csv',
  adminOnly,
  async (req, res, next) => {
    try {
      const rows =
        await Enquiry.findAll({
          order: [
            [
              'createdAt',
              'DESC'
            ]
          ]
        });


      const headers = [
        'ID',
        'Created',
        'Name',
        'Phone',
        'Email',
        'City',
        'Country',
        'NEET Score',
        'Status',
        'Message',
        'Notes',
        'Source'
      ];


      const lines = [
        headers
          .map(csvEscape)
          .join(',')
      ];


      for (const row of rows) {
        lines.push(
          [
            row.id,
            row.createdAt,
            row.name,
            row.phone,
            row.email,
            row.city,
            row.interestedCountry,
            row.neetScore,
            row.status,
            row.message,
            row.notes,
            row.source
          ]
            .map(csvEscape)
            .join(',')
        );
      }


      res.set({
        'Content-Type':
          'text/csv; charset=utf-8',

        'Content-Disposition':
          `attachment; filename="medico-enquiries-${new Date().toISOString().slice(0, 10)}.csv"`
      });


      return res.send(
        '\uFEFF' +
          lines.join('\r\n')
      );

    } catch (error) {
      next(error);
    }
  }
);


/* =========================================================
   UPDATE ENQUIRY
========================================================= */

app.patch(
  '/api/admin/enquiries/:id',
  adminOnly,
  async (req, res, next) => {
    try {
      const enquiry =
        await Enquiry.findByPk(
          req.params.id
        );


      if (!enquiry) {
        return res.status(404).json({
          message:
            'Enquiry not found.'
        });
      }


      const updates = {
        notes: clean(
          req.body.notes,
          3000
        )
      };


      if (
        [
          'new',
          'contacted',
          'qualified',
          'closed'
        ].includes(
          req.body.status
        )
      ) {
        updates.status =
          req.body.status;
      }


      await enquiry.update(
        updates
      );


      return res.json(
        enquiry
      );

    } catch (error) {
      next(error);
    }
  }
);


/* =========================================================
   DELETE ENQUIRY
========================================================= */

app.delete(
  '/api/admin/enquiries/:id',
  adminOnly,
  async (req, res, next) => {
    try {
      const count =
        await Enquiry.destroy({
          where: {
            id:
              req.params.id
          }
        });


      if (!count) {
        return res.status(404).json({
          message:
            'Enquiry not found.'
        });
      }


      return res.json({
        message:
          'Enquiry deleted.'
      });

    } catch (error) {
      next(error);
    }
  }
);


/* =========================================================
   ADMIN BLOGS
========================================================= */

app.get(
  '/api/admin/blogs',
  adminOnly,
  async (req, res, next) => {
    try {
      const blogs =
        await Blog.findAll({
          order: [
            [
              'createdAt',
              'DESC'
            ]
          ]
        });


      return res.json(
        blogs
      );

    } catch (error) {
      next(error);
    }
  }
);


/* =========================================================
   CREATE BLOG
========================================================= */

app.post(
  '/api/admin/blogs',
  adminOnly,
  async (req, res, next) => {
    try {
      const title =
        clean(
          req.body.title,
          220
        );


      if (!title) {
        return res.status(400).json({
          message:
            'Title is required.'
        });
      }


      let slug =
        clean(
          req.body.slug ||
            slugify(title, {
              lower: true,
              strict: true
            }),
          240
        );


      if (
        await Blog.count({
          where: {
            slug
          }
        })
      ) {
        slug +=
          '-' +
          crypto
            .randomBytes(3)
            .toString('hex');
      }


      const published =
        Boolean(
          req.body.published
        );


      const post =
        await Blog.create({
          title,

          slug,

          excerpt:
            clean(
              req.body.excerpt,
              1200
            ),

          category:
            clean(
              req.body.category ||
                'general',
              60
            ),

          content:
            clean(
              req.body.content,
              100000
            ),

          featuredImage:
            clean(
              req.body.featuredImage,
              500
            ),

          published,

          publishedAt:
            published
              ? new Date()
              : null
        });


      return res.status(201).json(
        post
      );

    } catch (error) {
      next(error);
    }
  }
);


/* =========================================================
   UPDATE BLOG
========================================================= */

app.put(
  '/api/admin/blogs/:id',
  adminOnly,
  async (req, res, next) => {
    try {
      const post =
        await Blog.findByPk(
          req.params.id
        );


      if (!post) {
        return res.status(404).json({
          message:
            'Post not found.'
        });
      }


      const published =
        Boolean(
          req.body.published
        );


      await post.update({
        title:
          clean(
            req.body.title ||
              post.title,
            220
          ),

        slug:
          clean(
            req.body.slug ||
              post.slug,
            240
          ),

        excerpt:
          clean(
            req.body.excerpt,
            1200
          ),

        category:
          clean(
            req.body.category ||
              'general',
            60
          ),

        content:
          clean(
            req.body.content,
            100000
          ),

        featuredImage:
          clean(
            req.body.featuredImage,
            500
          ),

        published,

        publishedAt:
          published &&
          !post.publishedAt
            ? new Date()
            : post.publishedAt
      });


      return res.json(
        post
      );

    } catch (error) {
      next(error);
    }
  }
);


/* =========================================================
   DELETE BLOG
========================================================= */

app.delete(
  '/api/admin/blogs/:id',
  adminOnly,
  async (req, res, next) => {
    try {
      const count =
        await Blog.destroy({
          where: {
            id:
              req.params.id
          }
        });


      if (!count) {
        return res.status(404).json({
          message:
            'Post not found.'
        });
      }


      return res.json({
        message:
          'Post deleted.'
      });

    } catch (error) {
      next(error);
    }
  }
);


/* =========================================================
   STATIC WEBSITE
========================================================= */

app.use(
  express.static(PUBLIC, {
    maxAge:
      process.env.NODE_ENV ===
      'production'
        ? '1d'
        : 0,

    extensions: [
      'html'
    ]
  })
);


/* =========================================================
   ADMIN PAGE
========================================================= */

app.get(
  '/admin',
  (req, res) => {
    res.sendFile(
      path.join(
        PUBLIC,
        'admin.html'
      )
    );
  }
);


/* =========================================================
   404
========================================================= */

app.use(
  (req, res) => {
    const notFoundPage =
      path.join(
        PUBLIC,
        '404.html'
      );

    return res
      .status(404)
      .sendFile(
        notFoundPage
      );
  }
);


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      'Server error:',
      error
    );


    return res.status(500).json({
      message:
        process.env.NODE_ENV ===
        'production'
          ? 'Internal server error.'
          : error.message
    });
  }
);


/* =========================================================
   START SERVER
========================================================= */

async function start() {
  try {
    if (
      !process.env.SESSION_SECRET ||
      process.env.SESSION_SECRET.length <
        32
    ) {
      console.warn(
        'WARNING: Set a strong SESSION_SECRET with at least 32 characters.'
      );
    }


    await sequelize.authenticate();

    console.log(
      'Database connection established.'
    );


    await sequelize.sync();

    console.log(
      'Database synchronized.'
    );


    app.listen(
      PORT,
      '0.0.0.0',
      () => {
        console.log(
          `Medico Overseas server running on port ${PORT}`
        );

        console.log(
          `AI enabled: ${Boolean(ai)}`
        );
      }
    );

  } catch (error) {
    console.error(
      'Startup error:',
      error
    );

    process.exit(1);
  }
}


start();