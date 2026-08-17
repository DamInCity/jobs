/**
 * Weekly scraper quality assessment.
 *
 * Efficient equivalent of a "cron job that thinks":
 * - One SQL-heavy Node script (no LLM required)
 * - Reads scraper_logs + jobs + job_sources for the last N days
 * - Scores each source, writes scraper_quality_reports + markdown under logs/
 * - Exit code 0 always unless --strict and gates fail
 *
 * Run:
 *   npm run scrape:quality
 *   node src/scrapers/qualityAssessment.js --days=7
 *   node src/scrapers/qualityAssessment.js --strict
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../db');

const DEFAULT_DAYS = 7;

function argValue(prefix, fallback) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return fallback;
  return hit.slice(prefix.length);
}

async function ensureTables() {
  // Quality table may already exist via migrate; keep CLI self-sufficient.
  await db.query(`
    CREATE TABLE IF NOT EXISTS scraper_quality_reports (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      period_start TIMESTAMP WITH TIME ZONE NOT NULL,
      period_end TIMESTAMP WITH TIME ZONE NOT NULL,
      report_json JSONB NOT NULL,
      summary_md TEXT,
      overall_score NUMERIC(5,2),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS scraper_logs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      scraper_name VARCHAR(100) NOT NULL,
      jobs_scraped INTEGER DEFAULT 0,
      jobs_saved INTEGER DEFAULT 0,
      errors INTEGER DEFAULT 0,
      duration VARCHAR(50),
      error_details TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function collectReport(days) {
  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const logs = await db.query(
    `SELECT scraper_name,
            COUNT(*)::int AS runs,
            COALESCE(SUM(jobs_scraped),0)::int AS scraped,
            COALESCE(SUM(jobs_saved),0)::int AS saved,
            COALESCE(SUM(errors),0)::int AS errors,
            MAX(created_at) AS last_run
     FROM scraper_logs
     WHERE created_at >= $1
     GROUP BY scraper_name
     ORDER BY saved DESC, scraper_name`,
    [periodStart]
  );

  const bySource = await db.query(
    `SELECT COALESCE(source, 'unknown') AS source,
            COUNT(*)::int AS jobs,
            COUNT(*) FILTER (WHERE status = 'active')::int AS active,
            COUNT(*) FILTER (WHERE county IS NOT NULL AND county <> '')::int AS with_county,
            COUNT(*) FILTER (WHERE country_code = 'KE')::int AS kenya_flagged,
            COUNT(*) FILTER (WHERE salary_currency = 'KES')::int AS kes_salary,
            COUNT(*) FILTER (WHERE description IS NULL OR length(description) < 40)::int AS thin_desc,
            COUNT(*) FILTER (WHERE external_link IS NULL OR external_link = '')::int AS missing_link,
            MAX(posted_date) AS newest_posted,
            MAX(created_at) AS newest_created
     FROM jobs
     WHERE created_at >= $1
     GROUP BY COALESCE(source, 'unknown')
     ORDER BY jobs DESC`,
    [periodStart]
  );

  const kenyaJobs = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE county IS NOT NULL)::int AS with_county,
            COUNT(*) FILTER (WHERE source_type = 'COMPANY_CAREER')::int AS career,
            COUNT(*) FILTER (WHERE source_type = 'GOVERNMENT')::int AS government,
            COUNT(*) FILTER (WHERE source_type = 'NGO')::int AS ngo,
            COUNT(*) FILTER (WHERE source_type = 'BOARD')::int AS board,
            COUNT(*) FILTER (WHERE source_type = 'API')::int AS api
     FROM jobs
     WHERE created_at >= $1
       AND (
         country_code = 'KE'
         OR location ILIKE '%kenya%'
         OR location ILIKE '%nairobi%'
         OR location ILIKE '%mombasa%'
         OR source ILIKE 'kenya:%'
         OR source ILIKE '%myjobmag%'
         OR source ILIKE '%brightermonday%'
       )`,
    [periodStart]
  );

  let jobSources = { rows: [] };
  try {
    jobSources = await db.query(
      `SELECT slug, name, source_type, parser_key, status,
              last_crawled_at, last_success_at, last_error,
              jobs_found_last, jobs_saved_last, crawl_frequency_hours
       FROM job_sources
       ORDER BY status, name`
    );
  } catch {
    // table may not exist on very old DBs pre-migrate
  }

  const logRows = logs.rows;
  const sourceRows = bySource.rows;
  const ke = kenyaJobs.rows[0] || {};
  const registry = jobSources.rows;

  const sourceScores = sourceRows.map((row) => {
    const jobs = row.jobs || 0;
    const countyRate = jobs ? row.with_county / jobs : 0;
    const thinRate = jobs ? row.thin_desc / jobs : 0;
    const keRate = jobs ? row.kenya_flagged / jobs : 0;
    // 0–100 score
    let score = 50;
    score += Math.min(25, jobs); // volume up to +25
    score += countyRate * 15;
    score += keRate * 10;
    score -= thinRate * 30;
    if (row.missing_link > 0) score -= 20;
    score = Math.max(0, Math.min(100, Math.round(score * 10) / 10));
    return {
      source: row.source,
      jobs,
      active: row.active,
      with_county: row.with_county,
      kenya_flagged: row.kenya_flagged,
      kes_salary: row.kes_salary,
      thin_desc: row.thin_desc,
      county_rate: round4(countyRate),
      thin_rate: round4(thinRate),
      score,
      newest_created: row.newest_created,
    };
  });

  const scraperScores = logRows.map((row) => {
    const scraped = row.scraped || 0;
    const saved = row.saved || 0;
    const errors = row.errors || 0;
    const saveRate = scraped ? saved / scraped : saved > 0 ? 1 : 0;
    const errRate = scraped + errors > 0 ? errors / (scraped + errors) : errors > 0 ? 1 : 0;
    let score = 40;
    score += saveRate * 40;
    score += Math.min(20, saved);
    score -= errRate * 40;
    if (row.runs === 0) score = 0;
    if (saved === 0 && scraped > 0) score = Math.min(score, 25);
    if (saved === 0 && errors > 0) score = Math.min(score, 15);
    score = Math.max(0, Math.min(100, Math.round(score * 10) / 10));
    return {
      scraper: row.scraper_name,
      runs: row.runs,
      scraped,
      saved,
      errors,
      save_rate: round4(saveRate),
      error_rate: round4(errRate),
      last_run: row.last_run,
      score,
    };
  });

  const deadSources = registry.filter(
    (s) => s.status === 'active'
      && (s.jobs_saved_last === 0 || s.jobs_saved_last == null)
      && s.last_crawled_at
      && s.last_error
  );

  const staleSources = registry.filter((s) => {
    if (s.status !== 'active' || !s.last_crawled_at) return false;
    const hours = s.crawl_frequency_hours || 24;
    const ageH = (Date.now() - new Date(s.last_crawled_at).getTime()) / 3600000;
    return ageH > hours * 3;
  });

  const overallParts = [
    ...scraperScores.map((s) => s.score),
    ...sourceScores.slice(0, 15).map((s) => s.score),
  ];
  const overall = overallParts.length
    ? Math.round((overallParts.reduce((a, b) => a + b, 0) / overallParts.length) * 10) / 10
    : 0;

  const gates = {
    has_scraper_runs: logRows.some((r) => r.runs > 0),
    kenya_jobs_min: (ke.total || 0) >= 5,
    any_source_with_county: sourceScores.some((s) => s.with_county > 0),
    no_total_scraper_blackout: scraperScores.length === 0 || scraperScores.some((s) => s.saved > 0),
    dead_sources_under: deadSources.length <= 15,
  };
  const gatesPassed = Object.values(gates).every(Boolean);

  const report = {
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    days,
    overall_score: overall,
    gates,
    gates_passed: gatesPassed,
    kenya: ke,
    scrapers: scraperScores,
    job_sources_ingested: sourceScores,
    registry: {
      total: registry.length,
      active: registry.filter((r) => r.status === 'active').length,
      dead_with_error: deadSources.map((d) => d.slug),
      stale: staleSources.map((d) => d.slug),
    },
    recommendations: buildRecommendations({
      scraperScores,
      sourceScores,
      ke,
      deadSources,
      staleSources,
      overall,
    }),
  };

  const summaryMd = renderMarkdown(report);
  return { report, summaryMd, periodStart, periodEnd, overall, gatesPassed };
}

function buildRecommendations(ctx) {
  const recs = [];
  const zeroSavers = ctx.scraperScores.filter((s) => s.saved === 0 && s.runs > 0);
  if (zeroSavers.length) {
    recs.push(
      `Scrapers with zero saves this period: ${zeroSavers.map((s) => s.scraper).join(', ')}. Check selectors/API keys/ToS blocks.`
    );
  }
  if ((ctx.ke.total || 0) < 20) {
    recs.push('Kenya-tagged volume is low — expand job_sources, enable MyJobMag, run scrape:kenya bootstrap.');
  }
  const thin = ctx.sourceScores.filter((s) => s.thin_rate > 0.4 && s.jobs >= 5);
  if (thin.length) {
    recs.push(
      `Thin descriptions from: ${thin.map((s) => s.source).join(', ')}. Prefer ATS adapters or detail-page fetch.`
    );
  }
  if (ctx.deadSources.length) {
    recs.push(
      `Active registry sources failing: ${ctx.deadSources
        .slice(0, 8)
        .map((d) => d.slug)
        .join(', ')}${ctx.deadSources.length > 8 ? '…' : ''}.`
    );
  }
  if (ctx.staleSources.length) {
    recs.push(`Stale sources (>> crawl frequency): ${ctx.staleSources.slice(0, 8).map((d) => d.slug).join(', ')}.`);
  }
  if (ctx.overall >= 70) {
    recs.push('Overall health looks good — keep weekly assessment and grow high-score upstream sources.');
  } else if (ctx.overall < 40) {
    recs.push('Overall score weak — prioritize fixing top scrapers before adding new sources.');
  }
  if (!recs.length) recs.push('No major issues detected.');
  return recs;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# JobsHub scraper quality report`);
  lines.push('');
  lines.push(`- **Period:** ${report.period_start} → ${report.period_end} (${report.days}d)`);
  lines.push(`- **Overall score:** ${report.overall_score}/100`);
  lines.push(`- **Gates passed:** ${report.gates_passed ? 'YES' : 'NO'}`);
  lines.push('');
  lines.push('## Kenya volume');
  lines.push('');
  lines.push(
    `| Total | County set | Career | Gov | NGO | Board | API |`
  );
  lines.push(`|---:|---:|---:|---:|---:|---:|---:|`);
  const k = report.kenya;
  lines.push(
    `| ${k.total || 0} | ${k.with_county || 0} | ${k.career || 0} | ${k.government || 0} | ${k.ngo || 0} | ${k.board || 0} | ${k.api || 0} |`
  );
  lines.push('');
  lines.push('## Scraper runs (from scraper_logs)');
  lines.push('');
  lines.push(`| Scraper | Runs | Scraped | Saved | Errors | Save rate | Score |`);
  lines.push(`|---|---:|---:|---:|---:|---:|---:|`);
  for (const s of report.scrapers) {
    lines.push(
      `| ${s.scraper} | ${s.runs} | ${s.scraped} | ${s.saved} | ${s.errors} | ${(s.save_rate * 100).toFixed(1)}% | ${s.score} |`
    );
  }
  if (!report.scrapers.length) lines.push(`| _(none)_ | 0 | 0 | 0 | 0 | — | 0 |`);
  lines.push('');
  lines.push('## Jobs ingested by source label');
  lines.push('');
  lines.push(`| Source | Jobs | County | KE flag | Thin desc | Score |`);
  lines.push(`|---|---:|---:|---:|---:|---:|`);
  for (const s of report.job_sources_ingested.slice(0, 30)) {
    lines.push(
      `| ${s.source} | ${s.jobs} | ${s.with_county} | ${s.kenya_flagged} | ${s.thin_desc} | ${s.score} |`
    );
  }
  lines.push('');
  lines.push('## Registry health');
  lines.push('');
  lines.push(`- Active sources: ${report.registry.active}/${report.registry.total}`);
  lines.push(
    `- Dead (error + 0 saved): ${report.registry.dead_with_error.length ? report.registry.dead_with_error.join(', ') : 'none'}`
  );
  lines.push(
    `- Stale: ${report.registry.stale.length ? report.registry.stale.join(', ') : 'none'}`
  );
  lines.push('');
  lines.push('## Recommendations');
  lines.push('');
  for (const r of report.recommendations) {
    lines.push(`- ${r}`);
  }
  lines.push('');
  lines.push(`_Generated at ${new Date().toISOString()}_`);
  return lines.join('\n');
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

async function persist(report, summaryMd, periodStart, periodEnd, overall) {
  const insert = await db.query(
    `INSERT INTO scraper_quality_reports (period_start, period_end, report_json, summary_md, overall_score)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     RETURNING id`,
    [periodStart, periodEnd, JSON.stringify(report), summaryMd, overall]
  );

  const logsDir = path.join(__dirname, '../../logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const mdPath = path.join(logsDir, `scraper-quality-${stamp}.md`);
  const jsonPath = path.join(logsDir, `scraper-quality-${stamp}.json`);
  fs.writeFileSync(mdPath, summaryMd, 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  // rolling latest
  fs.writeFileSync(path.join(logsDir, 'scraper-quality-latest.md'), summaryMd, 'utf8');
  fs.writeFileSync(path.join(logsDir, 'scraper-quality-latest.json'), JSON.stringify(report, null, 2), 'utf8');

  return { id: insert.rows[0].id, mdPath, jsonPath };
}

async function main() {
  const days = parseInt(argValue('--days=', String(DEFAULT_DAYS)), 10) || DEFAULT_DAYS;
  const strict = process.argv.includes('--strict');
  const noStore = process.argv.includes('--no-store');

  console.log(`\n📊 Scraper quality assessment (last ${days} days)\n`);

  await ensureTables();
  const { report, summaryMd, periodStart, periodEnd, overall, gatesPassed } =
    await collectReport(days);

  console.log(summaryMd);
  console.log('');

  if (!noStore) {
    const saved = await persist(report, summaryMd, periodStart, periodEnd, overall);
    console.log(`Saved report id=${saved.id}`);
    console.log(`Markdown: ${saved.mdPath}`);
  }

  await db.pool.end();

  if (strict && !gatesPassed) {
    console.error('\n❌ Quality gates failed (--strict)');
    process.exit(2);
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('Quality assessment failed:', err);
    try {
      await db.pool.end();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
}

module.exports = {
  collectReport,
  renderMarkdown,
  buildRecommendations,
};
