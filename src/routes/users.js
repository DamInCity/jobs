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
const { profileCvFile } = require('../services/cvProfiler');
const { ensurePreferenceAlert } = require('../jobs/emailAlerts');
const resumeTailor = require('../services/resumeTailor');

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
  const { email, password, name, telegram_username } = req.body;

  // Check if user exists
  const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existingUser.rows.length > 0) {
    throw new AppError('Email already registered', 409);
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 12);

  let tgUser = null;
  if (telegram_username !== undefined && telegram_username !== null && String(telegram_username).trim()) {
    tgUser = String(telegram_username).trim().replace(/^@/, '').slice(0, 64);
    if (!/^[A-Za-z0-9_]{5,64}$/.test(tgUser)) {
      throw new AppError('Telegram username must be 5–64 characters (letters, numbers, underscore)', 400);
    }
  }

  // Create user (telegram_username is optional contact hint; delivery still needs bot link)
  const result = await db.query(`
    INSERT INTO users (email, password_hash, name, role, telegram_username)
    VALUES ($1, $2, $3, 'user', $4)
    RETURNING id, email, name, role, telegram_username, created_at
  `, [email.toLowerCase(), passwordHash, name, tgUser]);

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
        telegram_username: user.telegram_username,
      },
      next_steps: {
        onboarding_url: '/alerts?onboarding=1',
        message: 'Upload your CV and link Telegram to receive matched jobs',
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

// Forgot password — always returns success (no email enumeration)
router.post('/forgot-password', userValidation.forgotPassword, asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const result = await db.query(
    'SELECT id, email, name FROM users WHERE email = $1',
    [email]
  );

  let resetUrl = null;
  if (result.rows.length > 0) {
    const user = result.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.query(
      `
      UPDATE users
      SET password_reset_token = $1, password_reset_expires = $2
      WHERE id = $3
      `,
      [token, expires, user.id]
    );

    resetUrl = `${config.app.url}/reset-password?token=${token}`;
    const html = `
      <p>Hi ${escapeHtmlEmail(user.name || 'there')},</p>
      <p>We received a request to reset your JobsHub password.</p>
      <p><a href="${resetUrl}" style="display:inline-block;background:#FF4F5E;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Reset password</a></p>
      <p>Or open this link:<br><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This link expires in 1 hour. If you did not request a reset, you can ignore this email.</p>
      <p>— JobsHub</p>
    `;

    try {
      const { sendEmail } = require('../jobs/emailAlerts');
      const mailResult = await sendEmail(user.email, 'Reset your JobsHub password', html);
      if (mailResult?.dryRun) {
        console.log(`🔑 [password-reset dry-run] ${user.email} → ${resetUrl}`);
      }
    } catch (error) {
      console.warn('Forgot-password email failed:', error.message);
      console.log(`🔑 [password-reset fallback] ${user.email} → ${resetUrl}`);
    }
  }

  const payload = {
    success: true,
    message: 'If an account exists for that email, we sent password reset instructions.',
  };

  // In non-production, include reset URL when SMTP is dry-run so local testing works
  if (config.env !== 'production' && resetUrl) {
    payload.data = { reset_url: resetUrl, dev_hint: true };
  }

  res.json(payload);
}));

// Reset password with token from email
router.post('/reset-password', userValidation.resetPassword, asyncHandler(async (req, res) => {
  const token = String(req.body.token || '').trim();
  const { password } = req.body;

  const result = await db.query(
    `
    SELECT id, email FROM users
    WHERE password_reset_token = $1
      AND password_reset_expires > NOW()
    LIMIT 1
    `,
    [token]
  );

  if (result.rows.length === 0) {
    throw new AppError('This reset link is invalid or has expired. Request a new one.', 400);
  }

  const user = result.rows[0];
  const passwordHash = await bcrypt.hash(password, 12);

  await db.query(
    `
    UPDATE users
    SET password_hash = $1,
        password_reset_token = NULL,
        password_reset_expires = NULL
    WHERE id = $2
    `,
    [passwordHash, user.id]
  );

  res.json({
    success: true,
    message: 'Password updated. You can sign in with your new password.',
  });
}));

function escapeHtmlEmail(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================
// PROFILE
// ============================================

// Get current user profile
router.get('/profile', authenticate, asyncHandler(async (req, res) => {
  const result = await db.query(`
    SELECT id, email, name, avatar_url, preferred_locations, preferred_job_types, 
           preferred_categories, email_verified, created_at,
           telegram_chat_id, telegram_username, whatsapp_number, notify_channels,
           cv_original_name, cv_uploaded_at,
           skills, profile_summary, profile_seniority, profile_keywords,
           profile_status, profiled_at,
           (cv_path IS NOT NULL) AS has_cv,
           (telegram_chat_id IS NOT NULL) AS telegram_linked
    FROM users WHERE id = $1
  `, [req.user.id]);

  const row = result.rows[0];
  const categoryNames = await resolveCategoryNames(row.preferred_categories);
  res.json({
    success: true,
    data: formatProfile(row, categoryNames),
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
    telegram_username,
    skills,
    profile_summary,
    profile_seniority,
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
  if (telegram_username !== undefined) {
    let tg = telegram_username ? String(telegram_username).trim().replace(/^@/, '') : null;
    if (tg === '') tg = null;
    if (tg && !/^[A-Za-z0-9_]{5,64}$/.test(tg)) {
      throw new AppError('Telegram username must be 5–64 characters (letters, numbers, underscore)', 400);
    }
    updates.push(`telegram_username = $${paramIndex++}`);
    params.push(tg);
  }
  if (skills !== undefined) {
    const cleanedSkills = Array.isArray(skills)
      ? [...new Set(skills.map((s) => String(s).trim()).filter(Boolean))].slice(0, 40)
      : [];
    updates.push(`skills = $${paramIndex++}`);
    params.push(cleanedSkills.length ? cleanedSkills : null);
    // Keep keyword filters in sync with manual skill list
    updates.push(`profile_keywords = $${paramIndex++}`);
    params.push(cleanedSkills.length ? cleanedSkills.slice(0, 12) : null);
    // Manual edits count as a confirmed profile when skills or other prefs exist
    updates.push(`profile_status = CASE
      WHEN profile_status = 'none' OR profile_status IS NULL THEN 'confirmed'
      ELSE profile_status
    END`);
    updates.push(`profiled_at = COALESCE(profiled_at, NOW())`);
  }
  if (profile_summary !== undefined) {
    updates.push(`profile_summary = $${paramIndex++}`);
    params.push(profile_summary ? String(profile_summary).slice(0, 1000) : null);
  }
  if (profile_seniority !== undefined) {
    updates.push(`profile_seniority = $${paramIndex++}`);
    params.push(profile_seniority || null);
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
              preferred_categories, notify_channels, whatsapp_number, telegram_username,
              skills, profile_summary, profile_seniority, profile_keywords,
              profile_status, profiled_at,
              cv_original_name, cv_uploaded_at,
              (cv_path IS NOT NULL) AS has_cv,
              (telegram_chat_id IS NOT NULL) AS telegram_linked
  `, params);

  const row = result.rows[0];
  const categoryNames = await resolveCategoryNames(row.preferred_categories);

  // Keep "My profile" alert in sync when prefs/skills change
  try {
    await ensurePreferenceAlert(req.user.id, row, {
      name: 'My profile',
      forceCreate: skills !== undefined || preferred_categories !== undefined,
    });
  } catch (err) {
    console.warn('Could not sync preference alert after profile update:', err.message);
  }

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: formatProfile(row, categoryNames),
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

// Change email (requires current password; reissues JWT)
router.post('/change-email', authenticate, userValidation.changeEmail, asyncHandler(async (req, res) => {
  const newEmail = String(req.body.email || '').toLowerCase().trim();
  const { password } = req.body;

  const result = await db.query(
    'SELECT id, email, password_hash, name, role FROM users WHERE id = $1',
    [req.user.id]
  );
  const user = result.rows[0];
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    throw new AppError('Current password is incorrect', 401);
  }

  if (newEmail === user.email.toLowerCase()) {
    throw new AppError('New email is the same as your current email', 400);
  }

  const taken = await db.query(
    'SELECT id FROM users WHERE email = $1 AND id <> $2',
    [newEmail, req.user.id]
  );
  if (taken.rows.length > 0) {
    throw new AppError('Email already registered', 409);
  }

  const updated = await db.query(
    `
    UPDATE users
    SET email = $1, email_verified = FALSE
    WHERE id = $2
    RETURNING id, email, name, role
    `,
    [newEmail, req.user.id]
  );

  const row = updated.rows[0];
  const token = generateToken(row);

  res.json({
    success: true,
    message: 'Email updated successfully',
    data: {
      token,
      user: {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
      },
    },
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
    SELECT cv_original_name, cv_uploaded_at, (cv_path IS NOT NULL) AS has_cv,
           skills, profile_summary, profile_seniority, profile_keywords,
           profile_status, profiled_at, preferred_categories, preferred_locations
    FROM users WHERE id = $1
    `,
    [req.user.id]
  );

  const row = result.rows[0];
  const categoryNames = await resolveCategoryNames(row.preferred_categories);
  res.json({
    success: true,
    data: {
      ...row,
      category_names: categoryNames,
    },
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

    await db.query(
      `
      UPDATE users
      SET cv_path = $1, cv_original_name = $2, cv_uploaded_at = NOW(),
          master_resume_json = NULL, master_resume_parsed_at = NULL
      WHERE id = $3
      `,
      [req.file.path, req.file.originalname, req.user.id]
    );

    // Profile from CV (rules + optional LLM)
    let profile = null;
    let profileError = null;
    try {
      profile = await profileCvFile(req.file.path);
      await applyCvProfileToUser(req.user.id, profile, { status: 'pending_confirm' });
    } catch (error) {
      profileError = error.message;
      console.warn(`CV profile failed for ${req.user.id}:`, error.message);
    }

    const result = await db.query(
      `
      SELECT id, email, name, preferred_locations, preferred_job_types, preferred_categories,
             skills, profile_summary, profile_seniority, profile_keywords,
             profile_status, profiled_at, telegram_username, notify_channels, whatsapp_number,
             cv_original_name, cv_uploaded_at,
             (cv_path IS NOT NULL) AS has_cv,
             (telegram_chat_id IS NOT NULL) AS telegram_linked
      FROM users WHERE id = $1
      `,
      [req.user.id]
    );
    const row = result.rows[0];
    const categoryNames = await resolveCategoryNames(row.preferred_categories);

    if (profile && !profileError) {
      try {
        await ensurePreferenceAlert(req.user.id, row, { name: 'My profile', forceCreate: true });
      } catch (err) {
        console.warn('Could not create profile alert:', err.message);
      }
    }

    res.status(201).json({
      success: true,
      message: profileError
        ? 'CV uploaded, but automatic profiling failed — set preferences manually'
        : 'CV uploaded and profiled — please confirm your profile',
      data: {
        ...formatProfile(row, categoryNames),
        profiling: profile
          ? {
              method: profile.method,
              confidence: profile.confidence,
              category_slugs: profile.category_slugs,
              extract_method: profile.extract_method,
            }
          : null,
        profile_error: profileError,
      },
    });
  })
);

// ============================================
// RESUME TAILOR (AI + PDF)
// ============================================

router.get('/resume/status', authenticate, asyncHandler(async (req, res) => {
  const result = await db.query(
    `
    SELECT (cv_path IS NOT NULL) AS has_cv,
           cv_original_name, cv_uploaded_at,
           master_resume_parsed_at,
           (master_resume_json IS NOT NULL) AS has_master_resume
    FROM users WHERE id = $1
    `,
    [req.user.id]
  );
  res.json({
    success: true,
    data: {
      ...result.rows[0],
      llm_configured: resumeTailor.isLlmConfigured(),
    },
  });
}));

router.get('/resume/candidates', authenticate, asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 8;
  const jobs = await resumeTailor.getResumeCandidates(req.user.id, limit);
  res.json({ success: true, data: jobs });
}));

router.post('/resume/parse', authenticate, asyncHandler(async (req, res) => {
  try {
    const { resume, cached, method } = await resumeTailor.ensureMasterResume(req.user.id, {
      force: true,
    });
    res.json({
      success: true,
      message: cached ? 'Master resume already up to date' : 'Master resume parsed',
      data: {
        method: method || (cached ? 'cache' : 'parsed'),
        basics: resume.basics,
        work_count: resume.work?.length || 0,
        skills_count: resume.skills?.length || 0,
        education_count: resume.education?.length || 0,
      },
    });
  } catch (error) {
    throw new AppError(error.message || 'Parse failed', error.status || 500);
  }
}));

router.post('/resume/tailor', authenticate, asyncHandler(async (req, res) => {
  const jobId = req.body?.job_id || req.body?.jobId;
  if (!jobId) {
    throw new AppError('job_id is required', 400);
  }

  try {
    const row = await resumeTailor.tailorAndSave(req.user.id, jobId);
    res.status(201).json({
      success: true,
      message: 'Tailored CV generated',
      data: {
        id: row.id,
        job_id: row.job_id,
        job_title: row.job_title,
        company_name: row.company_name,
        original_name: row.original_name,
        changes_summary: row.changes_summary,
        created_at: row.created_at,
        download_url: row.download_path,
        provider: row.provider,
      },
    });
  } catch (error) {
    throw new AppError(error.message || 'Tailor failed', error.status || 500);
  }
}));

router.get('/resume/tailored', authenticate, asyncHandler(async (req, res) => {
  const rows = await resumeTailor.listTailored(req.user.id);
  res.json({
    success: true,
    data: rows.map((r) => ({
      ...r,
      download_url: `/api/users/resume/tailored/${r.id}/download`,
    })),
  });
}));

router.get('/resume/tailored/:id/download', authenticate, asyncHandler(async (req, res) => {
  const row = await resumeTailor.getTailoredForUser(req.user.id, req.params.id);
  if (!row) {
    throw new AppError('Tailored resume not found', 404);
  }
  if (!row.file_path || !fs.existsSync(row.file_path)) {
    throw new AppError('File missing on server', 404);
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${(row.original_name || 'tailored-cv.pdf').replace(/"/g, '')}"`
  );
  fs.createReadStream(row.file_path).pipe(res);
}));

router.delete('/resume/tailored/:id', authenticate, asyncHandler(async (req, res) => {
  const ok = await resumeTailor.deleteTailored(req.user.id, req.params.id);
  if (!ok) {
    throw new AppError('Tailored resume not found', 404);
  }
  res.json({ success: true, message: 'Deleted' });
}));

// Re-run profiling on existing CV
router.post('/cv/reprofile', authenticate, asyncHandler(async (req, res) => {
  const prev = await db.query('SELECT cv_path FROM users WHERE id = $1', [req.user.id]);
  const cvPath = prev.rows[0]?.cv_path;
  if (!cvPath || !fs.existsSync(cvPath)) {
    throw new AppError('No CV on file to profile', 404);
  }

  const profile = await profileCvFile(cvPath);
  await applyCvProfileToUser(req.user.id, profile, { status: 'pending_confirm' });

  const result = await db.query(
    `
    SELECT id, email, name, preferred_locations, preferred_job_types, preferred_categories,
           skills, profile_summary, profile_seniority, profile_keywords,
           profile_status, profiled_at, telegram_username, notify_channels, whatsapp_number,
           cv_original_name, cv_uploaded_at,
           (cv_path IS NOT NULL) AS has_cv,
           (telegram_chat_id IS NOT NULL) AS telegram_linked
    FROM users WHERE id = $1
    `,
    [req.user.id]
  );
  const row = result.rows[0];
  await ensurePreferenceAlert(req.user.id, row, { name: 'My profile', forceCreate: true });
  const categoryNames = await resolveCategoryNames(row.preferred_categories);

  res.json({
    success: true,
    message: 'CV re-profiled — please confirm',
    data: formatProfile(row, categoryNames),
  });
}));

// Confirm or edit profile suggestions from CV
router.post('/profile/confirm', authenticate, asyncHandler(async (req, res) => {
  const {
    preferred_categories,
    preferred_locations,
    preferred_job_types,
    skills,
    profile_summary,
    profile_seniority,
  } = req.body || {};

  const updates = [`profile_status = 'confirmed'`, `profiled_at = NOW()`];
  const params = [];
  let i = 1;

  if (preferred_categories !== undefined) {
    updates.push(`preferred_categories = $${i++}`);
    params.push(preferred_categories);
  }
  if (preferred_locations !== undefined) {
    updates.push(`preferred_locations = $${i++}`);
    params.push(preferred_locations);
  }
  if (preferred_job_types !== undefined) {
    updates.push(`preferred_job_types = $${i++}`);
    params.push(preferred_job_types);
  }
  if (skills !== undefined) {
    updates.push(`skills = $${i++}`);
    updates.push(`profile_keywords = $${i++}`);
    const cleaned = Array.isArray(skills) ? skills.map(String).slice(0, 40) : [];
    params.push(cleaned, cleaned.slice(0, 12));
  }
  if (profile_summary !== undefined) {
    updates.push(`profile_summary = $${i++}`);
    params.push(profile_summary ? String(profile_summary).slice(0, 1000) : null);
  }
  if (profile_seniority !== undefined) {
    updates.push(`profile_seniority = $${i++}`);
    params.push(profile_seniority || null);
  }

  params.push(req.user.id);
  const result = await db.query(
    `
    UPDATE users SET ${updates.join(', ')}
    WHERE id = $${i}
    RETURNING id, email, name, preferred_locations, preferred_job_types, preferred_categories,
              skills, profile_summary, profile_seniority, profile_keywords,
              profile_status, profiled_at, telegram_username, notify_channels, whatsapp_number,
              cv_original_name, cv_uploaded_at,
              (cv_path IS NOT NULL) AS has_cv,
              (telegram_chat_id IS NOT NULL) AS telegram_linked
    `,
    params
  );

  const row = result.rows[0];
  await ensurePreferenceAlert(req.user.id, row, { name: 'My profile', forceCreate: true });
  const categoryNames = await resolveCategoryNames(row.preferred_categories);

  res.json({
    success: true,
    message: 'Profile confirmed — you will only get matching job alerts',
    data: formatProfile(row, categoryNames),
  });
}));

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

  // Remove file only — keep manual/CV-derived skills & preferences for matching
  await db.query(
    `
    UPDATE users
    SET cv_path = NULL, cv_original_name = NULL, cv_uploaded_at = NULL,
        master_resume_json = NULL, master_resume_parsed_at = NULL
    WHERE id = $1
    `,
    [req.user.id]
  );

  res.json({
    success: true,
    message: 'CV removed (skills and preferences kept)',
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

// ============================================
// PROFILE HELPERS
// ============================================

function formatProfile(row, categoryNames = []) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar_url: row.avatar_url,
    preferred_locations: row.preferred_locations,
    preferred_job_types: row.preferred_job_types,
    preferred_categories: row.preferred_categories,
    category_names: categoryNames,
    email_verified: row.email_verified,
    created_at: row.created_at,
    whatsapp_number: row.whatsapp_number,
    telegram_username: row.telegram_username,
    notify_channels: row.notify_channels || ['email'],
    skills: row.skills || [],
    profile_summary: row.profile_summary,
    profile_seniority: row.profile_seniority,
    profile_keywords: row.profile_keywords || [],
    profile_status: row.profile_status || 'none',
    profiled_at: row.profiled_at,
    cv_original_name: row.cv_original_name,
    cv_uploaded_at: row.cv_uploaded_at,
    has_cv: !!row.has_cv,
    telegram_linked: !!row.telegram_linked,
  };
}

async function resolveCategoryNames(categoryIds) {
  const ids = Array.isArray(categoryIds) ? categoryIds.filter(Boolean) : [];
  if (!ids.length) return [];
  try {
    const result = await db.query(
      `SELECT id, name, slug FROM categories WHERE id = ANY($1::uuid[])`,
      [ids]
    );
    return result.rows;
  } catch {
    return [];
  }
}

/**
 * Merge unique strings case-insensitively (existing first, then new).
 */
function mergeStringLists(existing, incoming, max = 40) {
  const out = [];
  const seen = new Set();
  for (const raw of [...(existing || []), ...(incoming || [])]) {
    const s = String(raw || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Map profile category slugs → UUIDs and merge onto the user.
 * CV profiling is additive: existing manual skills/categories/locations are kept.
 */
async function applyCvProfileToUser(userId, profile, options = {}) {
  const prev = await db.query(
    `
    SELECT preferred_categories, preferred_locations, skills, profile_keywords,
           profile_summary, profile_seniority
    FROM users WHERE id = $1
    `,
    [userId]
  );
  const existing = prev.rows[0] || {};

  const slugs = profile.category_slugs || [];
  let detectedCategoryIds = [];
  if (slugs.length) {
    const catResult = await db.query(
      `
      SELECT id FROM categories
      WHERE LOWER(slug) = ANY($1::text[])
         OR LOWER(name) = ANY($1::text[])
      `,
      [slugs.map((s) => String(s).toLowerCase())]
    );
    detectedCategoryIds = catResult.rows.map((r) => r.id);
  }

  const existingCats = Array.isArray(existing.preferred_categories)
    ? existing.preferred_categories.map(String)
    : [];
  const categoryIds = [...new Set([...existingCats, ...detectedCategoryIds.map(String)])];

  const cvSkills = Array.isArray(profile.skills) ? profile.skills.map(String) : [];
  const skills = mergeStringLists(existing.skills, cvSkills, 40);

  const cvKeywords = Array.isArray(profile.keywords) ? profile.keywords.map(String) : cvSkills;
  const keywords = mergeStringLists(existing.profile_keywords, cvKeywords, 12);

  const cvLocations = Array.isArray(profile.preferred_locations)
    ? profile.preferred_locations.map(String)
    : [];
  const locations = mergeStringLists(existing.preferred_locations, cvLocations, 8);

  // Prefer keeping a manual summary if present and CV didn't produce one
  const summary =
    profile.summary ||
    existing.profile_summary ||
    null;
  const seniority = profile.seniority || existing.profile_seniority || null;

  await db.query(
    `
    UPDATE users SET
      preferred_categories = $1,
      preferred_locations = $2,
      skills = $3,
      profile_keywords = $4,
      profile_summary = $5,
      profile_seniority = $6,
      profile_status = $7,
      profiled_at = NOW()
    WHERE id = $8
    `,
    [
      categoryIds.length ? categoryIds : null,
      locations.length ? locations : null,
      skills.length ? skills : null,
      keywords.length ? keywords : null,
      summary,
      seniority,
      options.status || 'pending_confirm',
      userId,
    ]
  );
}

module.exports = router;
