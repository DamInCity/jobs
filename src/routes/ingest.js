/**
 * Inbound job ingest API for n8n and other automation.
 * Auth: X-Ingest-Key or Authorization: Bearer <INGEST_API_KEY>
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { preprocessJob, preprocessJobs } = require('../scrapers/preprocessJob');
const { saveJobRecord } = require('../db/saveJobRecord');

const router = express.Router();

const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Ingest rate limit exceeded' },
});

function requireIngestKey(req, res, next) {
  const key = config.ingest.apiKey;
  if (!key) {
    return next(new AppError('Ingest API is not configured (INGEST_API_KEY)', 503));
  }

  const headerKey = req.get('X-Ingest-Key');
  const auth = req.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const provided = headerKey || bearer;

  if (!provided || provided !== key) {
    return next(new AppError('Invalid or missing ingest API key', 401));
  }
  return next();
}

router.use(ingestLimiter);
router.use(requireIngestKey);

/**
 * POST /api/ingest/preprocess
 * Dry-run normalization for n8n debugging.
 */
router.post('/preprocess', asyncHandler(async (req, res) => {
  const items = normalizeBodyToList(req.body);
  const { accepted, rejected } = preprocessJobs(items, {
    defaultSource: req.body?.source || 'n8n-google',
    maxAgeDays: req.body?.maxAgeDays,
  });
  res.json({
    success: true,
    data: {
      accepted_count: accepted.length,
      rejected_count: rejected.length,
      accepted,
      rejected,
    },
  });
}));

/**
 * POST /api/ingest/jobs
 * Body: single job object OR { jobs: [...], source?: string }
 */
router.post('/jobs', asyncHandler(async (req, res) => {
  const items = normalizeBodyToList(req.body);
  if (items.length === 0) {
    throw new AppError('Provide a job object or { jobs: [...] }', 400);
  }
  if (items.length > 100) {
    throw new AppError('Maximum 100 jobs per request', 400);
  }

  const source = req.body?.source || items[0]?.source || 'n8n-google';
  const results = {
    accepted: 0,
    skipped: 0,
    errors: [],
    ids: [],
  };

  for (const item of items) {
    const pre = preprocessJob(item, {
      defaultSource: source,
      maxAgeDays: req.body?.maxAgeDays ?? 45,
    });
    if (!pre.ok) {
      results.skipped += 1;
      results.errors.push({ title: item?.title, reason: pre.reason });
      continue;
    }

    const saved = await saveJobRecord(pre.job, {
      source: pre.job.source || source,
      skipPreprocess: true,
    });

    if (saved.saved) {
      results.accepted += 1;
      results.ids.push(saved.id);
    } else {
      results.skipped += 1;
      results.errors.push({
        title: pre.job.title,
        reason: saved.reason || 'not_saved',
      });
    }
  }

  // Notify subscribers when new jobs landed (same as post-scrape path)
  let alerts = null;
  if (results.accepted > 0 && req.body?.notify !== false) {
    try {
      const { processAlertsInProcess } = require('../jobs/emailAlerts');
      await processAlertsInProcess('daily');
      alerts = { triggered: true, frequency: 'daily' };
    } catch (error) {
      console.error('⚠️ Alert notifications after ingest failed:', error.message);
      alerts = { triggered: false, error: error.message };
    }
  }

  res.status(results.accepted > 0 ? 201 : 200).json({
    success: true,
    data: { ...results, alerts },
  });
}));

function normalizeBodyToList(body) {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.jobs)) return body.jobs;
  if (Array.isArray(body)) return body;
  if (body.title || body.job_title || body.external_link || body.url) return [body];
  return [];
}

module.exports = router;
