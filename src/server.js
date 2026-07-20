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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: config.env,
  });
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
  '/categories': 'categories.html',
  '/about': 'about.html',
  '/alerts': 'alerts.html',
  '/job-alerts': 'alerts.html',
};

Object.entries(pageRoutes).forEach(([route, file]) => {
  app.get(route, (req, res) => {
    res.sendFile(path.join(publicDir, file));
  });
});

// Admin panel
app.get('/admin', (req, res) => {
  res.redirect(301, '/admin/');
});
app.get('/admin/', (req, res) => {
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
}

async function start() {
  await bootstrapSchema();

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
