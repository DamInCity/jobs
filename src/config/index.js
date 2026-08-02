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

  // Job alert matching + diagnostic test loop
  alerts: {
    // First-send / backfill lookback (days). Was hard-coded 24h and missed older listings.
    lookbackDays: Math.max(1, parseInt(process.env.ALERT_LOOKBACK_DAYS, 10) || 30),
    // While > 0 and process runs with --test-loop, send 1 matched job to each Telegram-linked user every N minutes
    testIntervalMinutes: Math.max(0, parseInt(process.env.ALERT_TEST_INTERVAL_MINUTES, 10) || 0),
  },

  n8n: {
    webhookUrl: process.env.N8N_WEBHOOK_URL || '',
  },

  ingest: {
    apiKey: process.env.INGEST_API_KEY || '',
  },

  // SpaceXAI / xAI for optional CV LLM profiling (fallback if SiliconFlow unset)
  xai: {
    apiKey: process.env.XAI_API_KEY || '',
    model: process.env.XAI_MODEL || 'grok-4.5',
  },

  // SiliconFlow (primary LLM for CV profile + resume tailor)
  // https://docs.siliconflow.cn — OpenAI-compatible /v1/chat/completions
  siliconflow: {
    apiKey: process.env.SILICONFLOW_API_KEY || '',
    baseUrl: process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1',
    model: process.env.SILICONFLOW_MODEL || 'Qwen/Qwen2.5-72B-Instruct',
  },

  scrapers: {
    enableHtml: process.env.ENABLE_HTML_SCRAPERS === 'true',
  },

  uploads: {
    cvDir: process.env.CV_UPLOAD_DIR || require('path').join(__dirname, '../../uploads/cvs'),
    maxCvBytes: parseInt(process.env.MAX_CV_BYTES, 10) || 5 * 1024 * 1024,
    tailoredKeep: Math.max(5, parseInt(process.env.TAILORED_RESUME_KEEP, 10) || 20),
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
