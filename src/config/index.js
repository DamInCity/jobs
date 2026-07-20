require('dotenv').config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'jobs_website',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@jobswebsite.com',
    password: process.env.ADMIN_PASSWORD || 'changeme',
  },
  
  app: {
    name: process.env.APP_NAME || 'JobsHub',
    url: process.env.APP_URL || 'http://localhost:3000',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  },
  
  email: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.EMAIL_FROM || 'noreply@jobswebsite.com',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    botUsername: process.env.TELEGRAM_BOT_USERNAME || '',
  },

  n8n: {
    webhookUrl: process.env.N8N_WEBHOOK_URL || '',
  },

  uploads: {
    cvDir: process.env.CV_UPLOAD_DIR || require('path').join(__dirname, '../../uploads/cvs'),
    maxCvBytes: parseInt(process.env.MAX_CV_BYTES, 10) || 5 * 1024 * 1024,
  },
  
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  },
  
  pagination: {
    defaultPageSize: parseInt(process.env.DEFAULT_PAGE_SIZE, 10) || 20,
    maxPageSize: parseInt(process.env.MAX_PAGE_SIZE, 10) || 100,
  },

  rapidapi: {
    // Support both RAPIDAPI_KEY and legacy RAPID_API_KEY
    key: process.env.RAPIDAPI_KEY || process.env.RAPID_API_KEY || '',
    maxRequestsPerRun: parseInt(process.env.RAPIDAPI_MAX_REQUESTS_PER_RUN, 10) || 80,
    maxJobsPerSource: parseInt(process.env.INGEST_MAX_JOBS_PER_SOURCE, 10) || 400,
  },
};

module.exports = config;
