const db = require('./index');

const migrations = `
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Job types enum
DO $$ BEGIN
  CREATE TYPE job_type AS ENUM ('remote', 'hybrid', 'onsite');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Job status enum
DO $$ BEGIN
  CREATE TYPE job_status AS ENUM ('active', 'expired', 'draft');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- User role enum
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'user');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Alert frequency enum
DO $$ BEGIN
  CREATE TYPE alert_frequency AS ENUM ('daily', 'weekly');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL UNIQUE,
  slug VARCHAR(100) NOT NULL UNIQUE,
  icon VARCHAR(50),
  description TEXT,
  job_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(300) NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  company_logo_url TEXT,
  company_website TEXT,
  description TEXT NOT NULL,
  requirements TEXT,
  benefits TEXT,
  location VARCHAR(255) NOT NULL,
  job_type job_type NOT NULL DEFAULT 'onsite',
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  salary_min INTEGER,
  salary_max INTEGER,
  salary_currency VARCHAR(10) DEFAULT 'USD',
  salary_period VARCHAR(20) DEFAULT 'yearly',
  external_link TEXT NOT NULL,
  posted_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expiry_date TIMESTAMP WITH TIME ZONE,
  status job_status DEFAULT 'active',
  view_count INTEGER DEFAULT 0,
  click_count INTEGER DEFAULT 0,
  is_featured BOOLEAN DEFAULT FALSE,
  featured_until TIMESTAMP WITH TIME ZONE,
  meta_title VARCHAR(255),
  meta_description TEXT,
  source VARCHAR(100) DEFAULT 'manual',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for jobs table
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category_id);
CREATE INDEX IF NOT EXISTS idx_jobs_location ON jobs(location);
CREATE INDEX IF NOT EXISTS idx_jobs_job_type ON jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_jobs_posted_date ON jobs(posted_date DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_is_featured ON jobs(is_featured);
CREATE INDEX IF NOT EXISTS idx_jobs_slug ON jobs(slug);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_external_link ON jobs(external_link);

-- Full-text search index for jobs
CREATE INDEX IF NOT EXISTS idx_jobs_search ON jobs USING gin(
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(company_name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(location, ''))
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role user_role DEFAULT 'user',
  avatar_url TEXT,
  email_verified BOOLEAN DEFAULT FALSE,
  email_verification_token VARCHAR(255),
  password_reset_token VARCHAR(255),
  password_reset_expires TIMESTAMP WITH TIME ZONE,
  preferred_locations TEXT[], -- Array of preferred locations
  preferred_job_types job_type[],
  preferred_categories UUID[],
  telegram_chat_id VARCHAR(64),
  whatsapp_number VARCHAR(32),
  notify_channels TEXT[] DEFAULT ARRAY['email']::TEXT[],
  cv_path TEXT,
  cv_original_name VARCHAR(255),
  cv_uploaded_at TIMESTAMP WITH TIME ZONE,
  telegram_link_token VARCHAR(64),
  telegram_link_expires TIMESTAMP WITH TIME ZONE,
  last_login TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Saved jobs table
CREATE TABLE IF NOT EXISTS saved_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  notes TEXT,
  saved_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_jobs_user ON saved_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_jobs_job ON saved_jobs(job_id);

-- Job alerts table
CREATE TABLE IF NOT EXISTS job_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255),
  search_criteria JSONB NOT NULL DEFAULT '{}',
  frequency alert_frequency DEFAULT 'daily',
  is_active BOOLEAN DEFAULT TRUE,
  last_sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_job_alerts_user ON job_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_job_alerts_active ON job_alerts(is_active);

-- Per-user job delivery log (prevents re-sending the same job in digests)
CREATE TABLE IF NOT EXISTS job_alert_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  alert_id UUID REFERENCES job_alerts(id) ON DELETE SET NULL,
  channel VARCHAR(32),
  is_test BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_job_alert_deliveries_user ON job_alert_deliveries(user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_alert_deliveries_job ON job_alert_deliveries(job_id);

-- Job views tracking (for analytics)
CREATE TABLE IF NOT EXISTS job_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  referrer TEXT,
  viewed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_job_views_job ON job_views(job_id);
CREATE INDEX IF NOT EXISTS idx_job_views_date ON job_views(viewed_at);

-- Job clicks tracking (for analytics)
CREATE TABLE IF NOT EXISTS job_clicks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  clicked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_job_clicks_job ON job_clicks(job_id);
CREATE INDEX IF NOT EXISTS idx_job_clicks_date ON job_clicks(clicked_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_jobs_updated_at ON jobs;
CREATE TRIGGER update_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_categories_updated_at ON categories;
CREATE TRIGGER update_categories_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_job_alerts_updated_at ON job_alerts;
CREATE TRIGGER update_job_alerts_updated_at
  BEFORE UPDATE ON job_alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update category job count
CREATE OR REPLACE FUNCTION update_category_job_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE categories SET job_count = job_count + 1 WHERE id = NEW.category_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE categories SET job_count = job_count - 1 WHERE id = OLD.category_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.category_id IS DISTINCT FROM NEW.category_id THEN
    IF OLD.category_id IS NOT NULL THEN
      UPDATE categories SET job_count = job_count - 1 WHERE id = OLD.category_id;
    END IF;
    IF NEW.category_id IS NOT NULL THEN
      UPDATE categories SET job_count = job_count + 1 WHERE id = NEW.category_id;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_category_count ON jobs;
CREATE TRIGGER update_category_count
  AFTER INSERT OR UPDATE OR DELETE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_category_job_count();

-- Additive columns for existing databases (idempotent)
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_channels TEXT[] DEFAULT ARRAY['email']::TEXT[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS cv_path TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cv_original_name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS cv_uploaded_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_link_token VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_link_expires TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS skills TEXT[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_summary TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_seniority VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_keywords TEXT[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_status VARCHAR(32) DEFAULT 'none';
ALTER TABLE users ADD COLUMN IF NOT EXISTS profiled_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS master_resume_json JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS master_resume_parsed_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_users_telegram_chat ON users(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_telegram_link_token ON users(telegram_link_token) WHERE telegram_link_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_profile_status ON users(profile_status) WHERE profile_status IS NOT NULL AND profile_status <> 'none';

-- Tailored CVs generated for specific job opportunities
CREATE TABLE IF NOT EXISTS tailored_resumes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  job_title TEXT,
  company_name TEXT,
  file_path TEXT NOT NULL,
  original_name VARCHAR(255),
  changes_summary TEXT,
  tailored_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tailored_resumes_user ON tailored_resumes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tailored_resumes_job ON tailored_resumes(job_id) WHERE job_id IS NOT NULL;

-- S1: Kenya-local job metadata + upstream source registry
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS county VARCHAR(100);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS country_code CHAR(2) DEFAULT 'KE';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_type VARCHAR(40) DEFAULT 'BOARD';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS application_url TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS verification_status VARCHAR(32) DEFAULT 'aggregated';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_aggregated BOOLEAN DEFAULT TRUE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deadline TIMESTAMP WITH TIME ZONE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_source_id UUID;

CREATE INDEX IF NOT EXISTS idx_jobs_county ON jobs(county) WHERE county IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_country_code ON jobs(country_code);
CREATE INDEX IF NOT EXISTS idx_jobs_source_type ON jobs(source_type);
CREATE INDEX IF NOT EXISTS idx_jobs_verification ON jobs(verification_status);
CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);

CREATE TABLE IF NOT EXISTS job_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug VARCHAR(120) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  source_type VARCHAR(40) NOT NULL DEFAULT 'COMPANY_CAREER',
  base_url TEXT NOT NULL,
  parser_key VARCHAR(60) NOT NULL DEFAULT 'generic-html',
  parser_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  county_hint VARCHAR(100),
  country_code CHAR(2) DEFAULT 'KE',
  crawl_frequency_hours INTEGER DEFAULT 12,
  last_crawled_at TIMESTAMP WITH TIME ZONE,
  last_success_at TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  jobs_found_last INTEGER DEFAULT 0,
  jobs_saved_last INTEGER DEFAULT 0,
  status VARCHAR(32) DEFAULT 'active',
  robots_ok BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_job_sources_status ON job_sources(status);
CREATE INDEX IF NOT EXISTS idx_job_sources_type ON job_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_job_sources_parser ON job_sources(parser_key);

ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_job_source_id_fkey;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_job_source_id_fkey
  FOREIGN KEY (job_source_id) REFERENCES job_sources(id) ON DELETE SET NULL;

-- Weekly / historical scraper quality snapshots
CREATE TABLE IF NOT EXISTS scraper_quality_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  period_end TIMESTAMP WITH TIME ZONE NOT NULL,
  report_json JSONB NOT NULL,
  summary_md TEXT,
  overall_score NUMERIC(5,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scraper_quality_reports_created
  ON scraper_quality_reports(created_at DESC);

-- Idempotent delivery log for existing DBs
CREATE TABLE IF NOT EXISTS job_alert_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  alert_id UUID REFERENCES job_alerts(id) ON DELETE SET NULL,
  channel VARCHAR(32),
  is_test BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_job_alert_deliveries_user ON job_alert_deliveries(user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_alert_deliveries_job ON job_alert_deliveries(job_id);
`;

/**
 * Run migrations without ending the shared pool (safe for app startup).
 */
async function runMigrationsInProcess() {
  console.log('🚀 Running database migrations...');
  await db.query(migrations);
  console.log('✅ Migrations completed successfully');
}

/**
 * CLI entry: run migrations then close the pool.
 */
async function runMigrations() {
  try {
    await runMigrationsInProcess();
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations, runMigrationsInProcess, migrations };
