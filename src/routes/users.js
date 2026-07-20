const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const { authenticate, generateToken } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { userValidation } = require('../middleware/validation');

const router = express.Router();

// Ensure CV upload directory exists
const cvDir = config.uploads.cvDir;
fs.mkdirSync(cvDir, { recursive: true });

const cvStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, cvDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
    cb(null, `${req.user.id}-${Date.now()}${ext}`);
  },
});

const cvUpload = multer({
  storage: cvStorage,
  limits: { fileSize: config.uploads.maxCvBytes },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || ['.pdf', '.doc', '.docx'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new AppError('Only PDF or Word documents are allowed', 400));
    }
  },
});

// ============================================
// AUTHENTICATION
// ============================================

// Register new user
router.post('/register', userValidation.register, asyncHandler(async (req, res) => {
  const { email, password, name } = req.body;

  // Check if user exists
  const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existingUser.rows.length > 0) {
    throw new AppError('Email already registered', 409);
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 12);

  // Create user
  const result = await db.query(`
    INSERT INTO users (email, password_hash, name, role)
    VALUES ($1, $2, $3, 'user')
    RETURNING id, email, name, role, created_at
  `, [email.toLowerCase(), passwordHash, name]);

  const user = result.rows[0];
  const token = generateToken(user);

  res.status(201).json({
    success: true,
    message: 'Registration successful',
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    },
  });
}));

// Login
router.post('/login', userValidation.login, asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const result = await db.query(
    'SELECT id, email, password_hash, name, role FROM users WHERE email = $1',
    [email.toLowerCase()]
  );

  if (result.rows.length === 0) {
    throw new AppError('Invalid email or password', 401);
  }

  const user = result.rows[0];
  const isValidPassword = await bcrypt.compare(password, user.password_hash);

  if (!isValidPassword) {
    throw new AppError('Invalid email or password', 401);
  }

  // Update last login
  await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

  const token = generateToken(user);

  res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    },
  });
}));

// ============================================
// PROFILE
// ============================================

// Get current user profile
router.get('/profile', authenticate, asyncHandler(async (req, res) => {
  const result = await db.query(`
    SELECT id, email, name, avatar_url, preferred_locations, preferred_job_types, 
           preferred_categories, email_verified, created_at,
           telegram_chat_id, whatsapp_number, notify_channels,
           cv_original_name, cv_uploaded_at,
           (cv_path IS NOT NULL) AS has_cv,
           (telegram_chat_id IS NOT NULL) AS telegram_linked
    FROM users WHERE id = $1
  `, [req.user.id]);

  const row = result.rows[0];
  res.json({
    success: true,
    data: {
      id: row.id,
      email: row.email,
      name: row.name,
      avatar_url: row.avatar_url,
      preferred_locations: row.preferred_locations,
      preferred_job_types: row.preferred_job_types,
      preferred_categories: row.preferred_categories,
      email_verified: row.email_verified,
      created_at: row.created_at,
      whatsapp_number: row.whatsapp_number,
      notify_channels: row.notify_channels || ['email'],
      cv_original_name: row.cv_original_name,
      cv_uploaded_at: row.cv_uploaded_at,
      has_cv: !!row.has_cv,
      telegram_linked: !!row.telegram_linked,
    },
  });
}));

// Update profile
router.put('/profile', authenticate, userValidation.updateProfile, asyncHandler(async (req, res) => {
  const {
    name,
    avatar_url,
    preferred_locations,
    preferred_job_types,
    preferred_categories,
    notify_channels,
    whatsapp_number,
  } = req.body;

  const updates = [];
  const params = [];
  let paramIndex = 1;

  if (name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    params.push(name);
  }
  if (avatar_url !== undefined) {
    updates.push(`avatar_url = $${paramIndex++}`);
    params.push(avatar_url);
  }
  if (preferred_locations !== undefined) {
    updates.push(`preferred_locations = $${paramIndex++}`);
    params.push(preferred_locations);
  }
  if (preferred_job_types !== undefined) {
    updates.push(`preferred_job_types = $${paramIndex++}`);
    params.push(preferred_job_types);
  }
  if (preferred_categories !== undefined) {
    updates.push(`preferred_categories = $${paramIndex++}`);
    params.push(preferred_categories);
  }
  if (notify_channels !== undefined) {
    if (!Array.isArray(notify_channels) || notify_channels.length === 0) {
      throw new AppError('notify_channels must be a non-empty array', 400);
    }
    const allowed = new Set(['email', 'telegram', 'whatsapp']);
    const cleaned = notify_channels
      .map((c) => String(c).toLowerCase())
      .filter((c) => allowed.has(c));
    if (cleaned.length === 0) {
      throw new AppError('At least one valid channel is required (email, telegram, whatsapp)', 400);
    }
    updates.push(`notify_channels = $${paramIndex++}`);
    params.push(cleaned);
  }
  if (whatsapp_number !== undefined) {
    updates.push(`whatsapp_number = $${paramIndex++}`);
    params.push(whatsapp_number || null);
  }

  if (updates.length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  params.push(req.user.id);

  const result = await db.query(`
    UPDATE users SET ${updates.join(', ')} 
    WHERE id = $${paramIndex}
    RETURNING id, email, name, avatar_url, preferred_locations, preferred_job_types,
              preferred_categories, notify_channels, whatsapp_number,
              cv_original_name, cv_uploaded_at,
              (cv_path IS NOT NULL) AS has_cv,
              (telegram_chat_id IS NOT NULL) AS telegram_linked
  `, params);

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: result.rows[0],
  });
}));

// Change password
router.post('/change-password', authenticate, asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    throw new AppError('Current password and new password are required', 400);
  }

  if (new_password.length < 8) {
    throw new AppError('New password must be at least 8 characters', 400);
  }

  // Verify current password
  const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const isValid = await bcrypt.compare(current_password, result.rows[0].password_hash);

  if (!isValid) {
    throw new AppError('Current password is incorrect', 401);
  }

  // Update password
  const newHash = await bcrypt.hash(new_password, 12);
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);

  res.json({
    success: true,
    message: 'Password changed successfully',
  });
}));

// ============================================
// SAVED JOBS
// ============================================

// Get saved jobs
router.get('/saved-jobs', authenticate, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const [jobsResult, countResult] = await Promise.all([
    db.query(`
      SELECT 
        j.id, j.title, j.slug, j.company_name, j.company_logo_url,
        j.location, j.job_type, j.salary_min, j.salary_max, j.salary_currency,
        j.posted_date, j.status, j.external_link,
        sj.saved_at, sj.notes,
        c.name as category_name
      FROM saved_jobs sj
      JOIN jobs j ON sj.job_id = j.id
      LEFT JOIN categories c ON j.category_id = c.id
      WHERE sj.user_id = $1
      ORDER BY sj.saved_at DESC
      LIMIT $2 OFFSET $3
    `, [req.user.id, parseInt(limit), offset]),
    db.query('SELECT COUNT(*) FROM saved_jobs WHERE user_id = $1', [req.user.id]),
  ]);

  res.json({
    success: true,
    data: {
      jobs: jobsResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
      },
    },
  });
}));

// Save a job
router.post('/saved-jobs/:jobId', authenticate, asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const { notes } = req.body;

  // Check if job exists
  const jobExists = await db.query('SELECT id FROM jobs WHERE id = $1', [jobId]);
  if (jobExists.rows.length === 0) {
    throw new AppError('Job not found', 404);
  }

  // Save job (upsert)
  await db.query(`
    INSERT INTO saved_jobs (user_id, job_id, notes)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id, job_id) DO UPDATE SET notes = $3
  `, [req.user.id, jobId, notes]);

  res.status(201).json({
    success: true,
    message: 'Job saved successfully',
  });
}));

// Remove saved job
router.delete('/saved-jobs/:jobId', authenticate, asyncHandler(async (req, res) => {
  const { jobId } = req.params;

  await db.query(
    'DELETE FROM saved_jobs WHERE user_id = $1 AND job_id = $2',
    [req.user.id, jobId]
  );

  res.json({
    success: true,
    message: 'Job removed from saved list',
  });
}));

// Check if job is saved
router.get('/saved-jobs/:jobId/check', authenticate, asyncHandler(async (req, res) => {
  const { jobId } = req.params;

  const result = await db.query(
    'SELECT id FROM saved_jobs WHERE user_id = $1 AND job_id = $2',
    [req.user.id, jobId]
  );

  res.json({
    success: true,
    data: {
      isSaved: result.rows.length > 0,
    },
  });
}));

// ============================================
// TELEGRAM LINKING
// ============================================

// Create a short-lived link token + deep link URL
router.post('/telegram/link-token', authenticate, asyncHandler(async (req, res) => {
  if (!config.telegram.botToken || !config.telegram.botUsername) {
    throw new AppError(
      'Telegram bot is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME.',
      503
    );
  }

  const token = crypto.randomBytes(16).toString('hex');
  const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  await db.query(
    `
    UPDATE users
    SET telegram_link_token = $1, telegram_link_expires = $2
    WHERE id = $3
    `,
    [token, expires, req.user.id]
  );

  const username = config.telegram.botUsername.replace(/^@/, '');
  const deepLink = `https://t.me/${username}?start=${token}`;

  res.json({
    success: true,
    data: {
      token,
      deep_link: deepLink,
      expires_at: expires.toISOString(),
      bot_username: username,
    },
  });
}));

// Unlink Telegram
router.delete('/telegram/link', authenticate, asyncHandler(async (req, res) => {
  await db.query(
    `
    UPDATE users
    SET telegram_chat_id = NULL,
        telegram_link_token = NULL,
        telegram_link_expires = NULL,
        notify_channels = array_remove(COALESCE(notify_channels, ARRAY['email']::TEXT[]), 'telegram')
    WHERE id = $1
    `,
    [req.user.id]
  );

  res.json({
    success: true,
    message: 'Telegram unlinked',
  });
}));

// ============================================
// CV UPLOAD
// ============================================

router.get('/cv', authenticate, asyncHandler(async (req, res) => {
  const result = await db.query(
    `
    SELECT cv_original_name, cv_uploaded_at, (cv_path IS NOT NULL) AS has_cv
    FROM users WHERE id = $1
    `,
    [req.user.id]
  );

  res.json({
    success: true,
    data: result.rows[0],
  });
}));

router.post(
  '/cv',
  authenticate,
  (req, res, next) => {
    cvUpload.single('cv')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new AppError('CV must be 5MB or smaller', 400));
        }
        return next(new AppError(err.message, 400));
      }
      if (err) return next(err);
      next();
    });
  },
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('CV file is required (field name: cv)', 400);
    }

    // Remove previous file if present
    const prev = await db.query('SELECT cv_path FROM users WHERE id = $1', [req.user.id]);
    const oldPath = prev.rows[0]?.cv_path;
    if (oldPath && fs.existsSync(oldPath)) {
      try {
        fs.unlinkSync(oldPath);
      } catch {
        /* ignore */
      }
    }

    const result = await db.query(
      `
      UPDATE users
      SET cv_path = $1, cv_original_name = $2, cv_uploaded_at = NOW()
      WHERE id = $3
      RETURNING cv_original_name, cv_uploaded_at, (cv_path IS NOT NULL) AS has_cv
      `,
      [req.file.path, req.file.originalname, req.user.id]
    );

    res.status(201).json({
      success: true,
      message: 'CV uploaded successfully',
      data: result.rows[0],
    });
  })
);

router.delete('/cv', authenticate, asyncHandler(async (req, res) => {
  const prev = await db.query('SELECT cv_path FROM users WHERE id = $1', [req.user.id]);
  const oldPath = prev.rows[0]?.cv_path;
  if (oldPath && fs.existsSync(oldPath)) {
    try {
      fs.unlinkSync(oldPath);
    } catch {
      /* ignore */
    }
  }

  await db.query(
    `
    UPDATE users
    SET cv_path = NULL, cv_original_name = NULL, cv_uploaded_at = NULL
    WHERE id = $1
    `,
    [req.user.id]
  );

  res.json({
    success: true,
    message: 'CV removed',
  });
}));

// ============================================
// JOB ALERTS
// ============================================

// Get user's job alerts
router.get('/alerts', authenticate, asyncHandler(async (req, res) => {
  const result = await db.query(`
    SELECT id, name, search_criteria, frequency, is_active, last_sent_at, created_at
    FROM job_alerts
    WHERE user_id = $1
    ORDER BY created_at DESC
  `, [req.user.id]);

  res.json({
    success: true,
    data: result.rows,
  });
}));

// Create job alert
router.post('/alerts', authenticate, asyncHandler(async (req, res) => {
  const { name, search_criteria, frequency = 'daily' } = req.body;

  if (!search_criteria || Object.keys(search_criteria).length === 0) {
    throw new AppError('Search criteria is required', 400);
  }

  const allowedFreq = ['daily', 'weekly'];
  if (!allowedFreq.includes(frequency)) {
    throw new AppError('Frequency must be daily or weekly', 400);
  }

  // Strip empty criteria keys
  const cleaned = {};
  for (const [key, value] of Object.entries(search_criteria)) {
    if (value !== undefined && value !== null && value !== '') {
      cleaned[key] = value;
    }
  }
  if (Object.keys(cleaned).length === 0) {
    throw new AppError('At least one search criterion is required', 400);
  }

  const result = await db.query(`
    INSERT INTO job_alerts (user_id, name, search_criteria, frequency)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [req.user.id, name || null, JSON.stringify(cleaned), frequency]);

  // Best-effort: sync profile preferences from alert
  try {
    const prefUpdates = [];
    const prefParams = [];
    let i = 1;
    if (cleaned.category) {
      prefUpdates.push(`preferred_categories = ARRAY[$${i++}::uuid]`);
      prefParams.push(cleaned.category);
    }
    if (cleaned.location) {
      prefUpdates.push(`preferred_locations = ARRAY[$${i++}]`);
      prefParams.push(cleaned.location);
    }
    if (cleaned.job_type) {
      prefUpdates.push(`preferred_job_types = ARRAY[$${i++}::job_type]`);
      prefParams.push(cleaned.job_type);
    }
    if (prefUpdates.length) {
      prefParams.push(req.user.id);
      await db.query(
        `UPDATE users SET ${prefUpdates.join(', ')} WHERE id = $${i}`,
        prefParams
      );
    }
  } catch (err) {
    console.warn('Could not sync profile prefs from alert:', err.message);
  }

  res.status(201).json({
    success: true,
    message: 'Job alert created successfully',
    data: result.rows[0],
  });
}));

// Update job alert
router.put('/alerts/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, search_criteria, frequency, is_active } = req.body;

  const updates = [];
  const params = [];
  let paramIndex = 1;

  if (name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    params.push(name);
  }
  if (search_criteria !== undefined) {
    updates.push(`search_criteria = $${paramIndex++}`);
    params.push(JSON.stringify(search_criteria));
  }
  if (frequency !== undefined) {
    updates.push(`frequency = $${paramIndex++}`);
    params.push(frequency);
  }
  if (is_active !== undefined) {
    updates.push(`is_active = $${paramIndex++}`);
    params.push(is_active);
  }

  if (updates.length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  params.push(id, req.user.id);

  const result = await db.query(`
    UPDATE job_alerts SET ${updates.join(', ')}
    WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
    RETURNING *
  `, params);

  if (result.rows.length === 0) {
    throw new AppError('Job alert not found', 404);
  }

  res.json({
    success: true,
    message: 'Job alert updated successfully',
    data: result.rows[0],
  });
}));

// Delete job alert
router.delete('/alerts/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await db.query(
    'DELETE FROM job_alerts WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, req.user.id]
  );

  if (result.rows.length === 0) {
    throw new AppError('Job alert not found', 404);
  }

  res.json({
    success: true,
    message: 'Job alert deleted successfully',
  });
}));

module.exports = router;
