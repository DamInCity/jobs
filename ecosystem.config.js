module.exports = {
  apps: [
    {
      name: 'jobs-website',
      script: 'src/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: 'logs/error.log',
      out_file: 'logs/output.log',
      log_file: 'logs/combined.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'jobs-alerts',
      script: 'src/jobs/emailAlerts.js',
      args: '--force --frequency=all',
      instances: 1,
      autorestart: false,
      watch: false,
      cron_restart: '0 8 * * *', // Daily at 8 AM
      env_production: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'jobs-telegram-bot',
      script: 'src/jobs/telegramBot.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/telegram-error.log',
      out_file: 'logs/telegram-output.log',
      time: true,
    },
    {
      name: 'jobs-scraper',
      script: 'src/scrapers/scheduler.js',
      args: '--cron',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/scraper-error.log',
      out_file: 'logs/scraper-output.log',
      time: true,
      merge_logs: true,
    },
  ],
};
