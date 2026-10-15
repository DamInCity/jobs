const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const config = require('./config');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Import routes
const adminRoutes = require('./routes/admin');
const jobRoutes = require('./routes/jobs');
const categoryRoutes = require('./routes/categories');
const userRoutes = require('./routes/users');
const ingestRoutes = require('./routes/ingest');

const app = express();

// ============================================
// SECURITY MIDDLEWARE
// ============================================

// Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      // Allow inline onclick/onerror handlers used by public/js (Helmet defaults this to 'none')
      scriptSrcAttr: ["'unsafe-inline'"],
      connectSrc: ["'self'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
app.use(cors({
  origin: config.env === 'production' 
    ? config.app.frontendUrl 
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/telegram/webhook',
});
app.use('/api/', limiter);

// ============================================
// GENERAL MIDDLEWARE
// ============================================

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (config.env === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// ============================================
// STATIC FILES
// ============================================

const publicDir = path.join(__dirname, '../public');

app.use(express.static(publicDir, {
  maxAge: config.env === 'production' ? '1d' : 0,
  extensions: ['html'],
}));

// ============================================
// API ROUTES
// ============================================

app.use('/api/admin', adminRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/users', userRoutes);
app.use('/api/ingest', ingestRoutes);

app.post('/api/telegram/webhook', (req, res) => {
  const telegramBot = require('./jobs/telegramBot');
  if (!telegramBot.verifyWebhookRequest(req)) {
    return res.sendStatus(401);
  }
  res.sendStatus(200);
  telegramBot.handleUpdate(req.body).catch((error) => {
    console.error('Telegram webhook update failed:', error.message);
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: config.env,
  });
});

// Supply snapshot for n8n / uptime monitors (no secrets)
app.get('/api/health/supply', async (req, res) => {
  try {
    const { getSupplySnapshot } = require('./jobs/expiryMaintenance');
    const supply = await getSupplySnapshot();
    res.status(supply.gates_passed ? 200 : 503).json({
      success: supply.gates_passed,
      data: supply,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Supply health failed',
    });
  }
});

// ============================================
// SEO ROUTES
// ============================================

// Dynamic sitemap.xml
app.get('/sitemap.xml', async (req, res) => {
  const db = require('./db');
  const origin = config.app.url || 'https://jobshub.co.ke';
  res.type('application/xml');

  try {
    // Get all active jobs
    const jobs = await db.query(`
      SELECT slug, updated_at, posted_date
      FROM jobs
      WHERE expiry_date > NOW() AND (slug IS NOT NULL AND slug <> '')
      ORDER BY posted_date DESC
      LIMIT 50000
    `);

    // Get all categories
    const categories = await db.query(`
      SELECT slug, updated_at FROM categories ORDER BY name
    `);

    const urls = [
      // Static pages
      { loc: '/', priority: '1.0', changefreq: 'hourly' },
      { loc: '/categories', priority: '0.8', changefreq: 'daily' },
      { loc: '/alerts', priority: '0.6', changefreq: 'weekly' },
      { loc: '/about', priority: '0.5', changefreq: 'monthly' },
      { loc: '/login', priority: '0.3', changefreq: 'monthly' },
      { loc: '/register', priority: '0.3', changefreq: 'monthly' },

      // Category pages
      ...categories.rows.map((c) => ({
        loc: `/categories/${c.slug}`,
        priority: '0.7',
        changefreq: 'daily',
      })),

      // Job pages (every active job gets its own URL)
      ...jobs.rows.map((j) => ({
        loc: `/jobs/${j.slug}`,
        priority: '0.9',
        changefreq: 'daily',
        lastmod: (j.updated_at || j.posted_date)?.toISOString(),
      })),

      // Kenya pages
      { loc: '/kenya', priority: '0.9', changefreq: 'daily' },
      ...['nairobi', 'mombasa', 'kisumu', 'nakuru', 'eldoret', 'thika', 'malindi', 'kilifi', 'nanyuki', 'naivasha', 'kakamega', 'meru', 'nyeri', 'kisii', 'kericho', 'nandi', 'machakos', 'kiambu', 'muranga', 'embu', 'isiolo', 'baringo', 'bomet', 'bungoma', 'busia', 'elgeyo-marakwet', 'garissa', 'homa-bay', 'kajiado', 'kitui', 'kwale', 'laikipia', 'lamu', 'makueni', 'mandera', 'marsabit', 'migori', 'moyale', 'narok', 'nyamira', 'nyandarua', 'samburu', 'siaya', 'taita-taveta', 'tana-river', 'tharaka-nithi', 'trans-nzoia', 'turkana', 'uasin-gishu', 'vihiga', 'wajir', 'west-pokot'].map((c) => ({
        loc: `/kenya/${c}`,
        priority: '0.7',
        changefreq: 'daily',
      })),

      // Category pages
      ...categories.rows.map((c) => ({
        loc: `/categories/${c.slug}`,
        priority: '0.7',
        changefreq: 'daily',
      })),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((u) => `  <url>
    <loc>${origin}${u.loc}</loc>
    <priority>${u.priority}</priority>
    <changefreq>${u.changefreq}</changefreq>
    ${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>` : ''}
  </url>`)
  .join('\n')}
</urlset>`;
    res.send(xml);
  } catch (error) {
    console.error('Sitemap generation failed:', error.message);
    res.status(500).type('text').send('Sitemap generation failed');
  }
});

// robots.txt
app.get('/robots.txt', (req, res) => {
  const origin = config.app.url || 'https://jobshub.co.ke';
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/
Disallow: /login
Disallow: /register
Disallow: /forgot-password
Disallow: /reset-password

Sitemap: ${origin}/sitemap.xml
`);
});

// ============================================
// FRONTEND PAGE ROUTES
// ============================================

const pageRoutes = {
  '/login': 'login.html',
  '/signin': 'login.html',
  '/register': 'register.html',
  '/signup': 'register.html',
  '/sign-up': 'register.html',
  '/forgot-password': 'forgot-password.html',
  '/reset-password': 'reset-password.html',
  '/categories': 'categories.html',
  '/about': 'about.html',
  '/alerts': 'alerts.html',
  '/job-alerts': 'alerts.html',
  '/profile': 'profile.html',
  '/account': 'profile.html',
  '/kenya': 'kenya.html',
};

// Kenya county landing pages — all serve the same kenya.html (JS handles dynamic content)
const kenyaCounties = ['nairobi', 'mombasa', 'kisumu', 'nakuru', 'eldoret', 'thika', 'malindi', 'kilifi', 'nanyuki', 'naivasha', 'kakamega', 'meru', 'nyeri', 'kisii', 'kericho', 'nandi', 'machakos', 'kiambu', 'muranga', 'embu', 'isiolo', 'baringo', 'bomet', 'bungoma', 'busia', 'elgeyo-marakwet', 'garissa', 'homa-bay', 'kajiado', 'kitui', 'kwale', 'laikipia', 'lamu', 'makueni', 'mandera', 'marsabit', 'migori', 'moyale', 'narok', 'nyamira', 'nyandarua', 'samburu', 'siaya', 'taita-taveta', 'tana-river', 'tharaka-nithi', 'trans-nzoia', 'turkana', 'uasin-gishu', 'vihiga', 'wajir', 'west-pokot'];

kenyaCounties.forEach((county) => {
  app.get(`/kenya/${county}`, (req, res) => {
    res.sendFile(path.join(publicDir, 'kenya.html'));
  });
});

// Category landing pages for SEO
app.get('/categories/:slug', (req, res) => {
  res.sendFile(path.join(publicDir, 'categories.html'));
});

// PWA service worker — no long cache on the SW script itself
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.type('application/javascript');
  res.sendFile(path.join(publicDir, 'sw.js'));
});

app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(publicDir, 'manifest.webmanifest'));
});

Object.entries(pageRoutes).forEach(([route, file]) => {
  app.get(route, (req, res) => {
    res.sendFile(path.join(publicDir, file));
  });
});

// Admin panel (SPA): /admin, /admin/jobs, /admin/users, etc.
app.get(/^\/admin(\/.*)?$/, (req, res, next) => {
  if (path.extname(req.path)) return next();
  res.sendFile(path.join(publicDir, 'admin', 'index.html'));
});

// Homepage + unknown non-API paths → main app
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  // Don't rewrite real static assets
  if (path.extname(req.path)) {
    return next();
  }
  // Job detail pages — serve the SPA (JS handles content via modal)
  if (req.path.startsWith('/jobs/')) {
    return res.sendFile(path.join(publicDir, 'index.html'));
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ============================================
// ERROR HANDLING
// ============================================

app.use(notFoundHandler);
app.use(errorHandler);

// ============================================
// SERVER START
// ============================================

const PORT = config.port;
const db = require('./db');
const { runMigrationsInProcess } = require('./db/migrate');

async function bootstrapSchema() {
  // Always run migrations (idempotent CREATE + ALTER IF NOT EXISTS)
  console.log('📦 Running database migrations on startup...');
  try {
    await runMigrationsInProcess();
  } catch (error) {
    console.error('❌ Startup migrations failed:', error.message);
  }

  // Ensure full category catalog exists (needed for CV profiling + job taxonomy)
  try {
    const { categories } = require('./db/categories');
    for (const cat of categories) {
      await db.query(
        `INSERT INTO categories (name, slug, icon, description)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           icon = EXCLUDED.icon,
           description = EXCLUDED.description,
           updated_at = CURRENT_TIMESTAMP`,
        [cat.name, cat.slug, cat.icon, cat.description]
      );
    }
  } catch (error) {
    console.error('⚠️ Category bootstrap failed:', error.message);
  }
}

async function runExpiryMaintenanceSafe(label = 'startup') {
  try {
    const { expirePastDueJobs } = require('./jobs/expiryMaintenance');
    const result = await expirePastDueJobs();
    console.log(
      `🧹 Expiry maintenance (${label}): date=${result.expiredByDate} age=${result.expiredByAge} junk=${result.expiredJunkTitles}`
    );
    return result;
  } catch (error) {
    console.error(`⚠️ Expiry maintenance (${label}) failed:`, error.message);
    return null;
  }
}

async function start() {
  await bootstrapSchema();
  await runExpiryMaintenanceSafe('startup');
  try {
    const telegramBot = require('./jobs/telegramBot');
    await telegramBot.registerWebhook();
  } catch (error) {
    console.error('Telegram webhook register failed:', error.message);
  }

  // Keep inventory honest even if the scraper container is down
  const maintenanceMs = parseInt(process.env.EXPIRY_MAINTENANCE_MS || String(6 * 60 * 60 * 1000), 10);
  if (maintenanceMs > 0) {
    setInterval(() => {
      void runExpiryMaintenanceSafe('interval');
    }, maintenanceMs).unref?.();
  }

  const server = app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 ${config.app.name} Server Started!                        ║
║                                                           ║
║   Environment: ${config.env.padEnd(40)}║
║   Port: ${PORT.toString().padEnd(48)}║
║   URL: ${config.app.url.padEnd(48)}║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received. Shutting down gracefully...');
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

module.exports = app;
