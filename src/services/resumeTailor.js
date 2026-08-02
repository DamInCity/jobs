/**
 * AI resume parse + tailor (JSON Resume subset) + PDF render via pdfmake.
 * Uses SiliconFlow (or xAI fallback) through llmClient.
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const config = require('../config');
const { extractCvText } = require('./cvProfiler');
const llm = require('./llmClient');
const {
  criteriaFromPreferences,
  findMatchingJobsWithFallback,
} = require('../jobs/emailAlerts');

const TAILORED_KEEP = () => config.uploads?.tailoredKeep || 20;

function tailoredDir(userId) {
  const dir = path.join(config.uploads.cvDir, 'tailored', String(userId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function emptyResume() {
  return {
    basics: {
      name: '',
      label: '',
      email: '',
      phone: '',
      url: '',
      summary: '',
      location: { city: '', region: '', countryCode: '' },
    },
    work: [],
    education: [],
    skills: [],
    projects: [],
    languages: [],
    certificates: [],
  };
}

/**
 * Normalize LLM output into a safe JSON Resume subset.
 */
function normalizeResume(raw, fallbackName = '') {
  const base = emptyResume();
  if (!raw || typeof raw !== 'object') return base;

  const b = raw.basics && typeof raw.basics === 'object' ? raw.basics : {};
  base.basics = {
    name: String(b.name || fallbackName || '').slice(0, 200),
    label: String(b.label || b.title || '').slice(0, 200),
    email: String(b.email || '').slice(0, 200),
    phone: String(b.phone || '').slice(0, 80),
    url: String(b.url || b.website || '').slice(0, 300),
    summary: String(b.summary || '').slice(0, 2000),
    location: {
      city: String(b.location?.city || '').slice(0, 100),
      region: String(b.location?.region || '').slice(0, 100),
      countryCode: String(b.location?.countryCode || b.location?.country || '').slice(0, 80),
    },
  };

  base.work = asArray(raw.work)
    .slice(0, 12)
    .map((w) => ({
      name: String(w.name || w.company || '').slice(0, 200),
      position: String(w.position || w.title || '').slice(0, 200),
      startDate: String(w.startDate || w.start || '').slice(0, 40),
      endDate: String(w.endDate || w.end || '').slice(0, 40),
      summary: String(w.summary || '').slice(0, 1500),
      highlights: asArray(w.highlights || w.bullets)
        .map((h) => String(h).slice(0, 400))
        .filter(Boolean)
        .slice(0, 10),
    }))
    .filter((w) => w.name || w.position);

  base.education = asArray(raw.education)
    .slice(0, 8)
    .map((e) => ({
      institution: String(e.institution || e.school || '').slice(0, 200),
      area: String(e.area || e.field || '').slice(0, 200),
      studyType: String(e.studyType || e.degree || '').slice(0, 120),
      startDate: String(e.startDate || e.start || '').slice(0, 40),
      endDate: String(e.endDate || e.end || '').slice(0, 40),
    }))
    .filter((e) => e.institution || e.area);

  base.skills = asArray(raw.skills)
    .slice(0, 30)
    .map((s) => {
      if (typeof s === 'string') return { name: s.slice(0, 80), keywords: [] };
      return {
        name: String(s.name || s.skill || '').slice(0, 80),
        keywords: asArray(s.keywords)
          .map((k) => String(k).slice(0, 60))
          .filter(Boolean)
          .slice(0, 12),
      };
    })
    .filter((s) => s.name);

  base.projects = asArray(raw.projects)
    .slice(0, 8)
    .map((p) => ({
      name: String(p.name || '').slice(0, 200),
      description: String(p.description || p.summary || '').slice(0, 800),
      highlights: asArray(p.highlights)
        .map((h) => String(h).slice(0, 400))
        .filter(Boolean)
        .slice(0, 6),
    }))
    .filter((p) => p.name);

  base.languages = asArray(raw.languages)
    .slice(0, 10)
    .map((l) => {
      if (typeof l === 'string') return { language: l.slice(0, 60), fluency: '' };
      return {
        language: String(l.language || l.name || '').slice(0, 60),
        fluency: String(l.fluency || l.level || '').slice(0, 60),
      };
    })
    .filter((l) => l.language);

  base.certificates = asArray(raw.certificates || raw.certifications)
    .slice(0, 10)
    .map((c) => ({
      name: String(c.name || c.title || '').slice(0, 200),
      issuer: String(c.issuer || c.organization || '').slice(0, 200),
      date: String(c.date || c.endDate || '').slice(0, 40),
    }))
    .filter((c) => c.name);

  return base;
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Heuristic structured resume when LLM is unavailable.
 */
function ruleBasedResumeFromText(text, user = {}) {
  const resume = emptyResume();
  resume.basics.name = user.name || '';
  resume.basics.email = user.email || '';
  resume.basics.summary = String(user.profile_summary || text.slice(0, 400)).slice(0, 800);

  const skills = Array.isArray(user.skills) ? user.skills : [];
  resume.skills = skills.slice(0, 20).map((name) => ({ name: String(name), keywords: [] }));

  // Split into paragraphs for a rough work section
  const chunks = String(text)
    .split(/\n{2,}/)
    .map((c) => c.trim())
    .filter((c) => c.length > 40)
    .slice(0, 6);

  resume.work = chunks.slice(0, 3).map((chunk, i) => {
    const firstLine = chunk.split('\n')[0].slice(0, 120);
    return {
      name: firstLine || `Experience ${i + 1}`,
      position: '',
      startDate: '',
      endDate: '',
      summary: chunk.slice(0, 600),
      highlights: chunk
        .split(/\n/)
        .slice(1, 6)
        .map((l) => l.replace(/^[-•*]\s*/, '').trim())
        .filter((l) => l.length > 10),
    };
  });

  return resume;
}

/**
 * Parse master CV text into JSON Resume and store on user.
 * @param {string} userId
 * @param {{ force?: boolean }} [options]
 */
async function ensureMasterResume(userId, options = {}) {
  const result = await db.query(
    `
    SELECT id, email, name, cv_path, cv_uploaded_at, master_resume_json, master_resume_parsed_at,
           skills, profile_summary
    FROM users WHERE id = $1
    `,
    [userId]
  );
  const user = result.rows[0];
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  if (!user.cv_path || !fs.existsSync(user.cv_path)) {
    const err = new Error('Upload a CV first (PDF or DOCX)');
    err.status = 400;
    err.code = 'NO_CV';
    throw err;
  }

  const needsParse =
    options.force ||
    !user.master_resume_json ||
    !user.master_resume_parsed_at ||
    (user.cv_uploaded_at &&
      new Date(user.cv_uploaded_at) > new Date(user.master_resume_parsed_at));

  if (!needsParse && user.master_resume_json) {
    return {
      resume: normalizeResume(user.master_resume_json, user.name),
      cached: true,
      user,
    };
  }

  const { text } = await extractCvText(user.cv_path);
  if (!text || text.length < 40) {
    const err = new Error('Could not extract enough text from CV');
    err.status = 400;
    throw err;
  }

  let resume;
  let method = 'rules';

  if (llm.isConfigured()) {
    try {
      const system = `You convert a job-seeker CV into JSON Resume format. Reply with JSON only, no markdown.
Schema:
{"basics":{"name":"","label":"","email":"","phone":"","url":"","summary":"","location":{"city":"","region":"","countryCode":""}},"work":[{"name":"","position":"","startDate":"","endDate":"","summary":"","highlights":[]}],"education":[{"institution":"","area":"","studyType":"","startDate":"","endDate":""}],"skills":[{"name":"","keywords":[]}],"projects":[{"name":"","description":"","highlights":[]}],"languages":[{"language":"","fluency":""}],"certificates":[{"name":"","issuer":"","date":""}]}
Rules:
- Use ONLY facts present in the CV text. Never invent employers, degrees, dates, or skills.
- Prefer ISO-like dates (YYYY or YYYY-MM) when known; else leave empty string.
- highlights are achievement bullets.
- Max 12 work entries, 20 skill groups.`;

      const { parsed } = await llm.chatJson({
        temperature: 0.2,
        maxTokens: 4096,
        timeoutMs: 90000,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: `Candidate name hint: ${user.name || 'unknown'}\nEmail: ${user.email || ''}\n\nCV text:\n${text.slice(0, 14000)}`,
          },
        ],
      });
      resume = normalizeResume(parsed, user.name);
      method = 'llm';
    } catch (error) {
      console.warn('Master resume LLM parse failed:', error.message);
      resume = ruleBasedResumeFromText(text, user);
      method = 'rules-fallback';
    }
  } else {
    resume = ruleBasedResumeFromText(text, user);
  }

  if (!resume.basics.name && user.name) resume.basics.name = user.name;
  if (!resume.basics.email && user.email) resume.basics.email = user.email;

  await db.query(
    `
    UPDATE users
    SET master_resume_json = $1::jsonb, master_resume_parsed_at = NOW()
    WHERE id = $2
    `,
    [JSON.stringify(resume), userId]
  );

  return { resume, cached: false, method, user };
}

/**
 * Tailor master resume JSON toward a job posting.
 */
async function tailorResumeJson(masterResume, job) {
  if (!llm.isConfigured()) {
    const err = new Error(
      'Resume AI is not configured. Set SILICONFLOW_API_KEY (and SILICONFLOW_MODEL) in .env'
    );
    err.status = 503;
    err.code = 'LLM_NOT_CONFIGURED';
    throw err;
  }

  const jobBlock = [
    `Title: ${job.title || ''}`,
    `Company: ${job.company_name || ''}`,
    `Location: ${job.location || ''}`,
    `Type: ${job.job_type || ''}`,
    `Description:\n${String(job.description || '').slice(0, 8000)}`,
  ].join('\n');

  const system = `You tailor a master resume for one job application. Reply with JSON only:
{"resume":{...JSON Resume same shape as input...},"changes_summary":["bullet explaining a change",...]}
Rules:
1. NEVER invent employers, job titles, degrees, dates, tools, or metrics not supported by the master resume.
2. You MAY rephrase bullets, reorder work/skills, emphasize relevant projects, and rewrite the summary for the role.
3. Prefer omissions over fabrication. Drop irrelevant fluff if needed.
4. Keep all real employers; you may de-emphasize less relevant roles with shorter bullets.
5. changes_summary: 3-6 short plain-English bullets of what you changed.
6. Output language: match the master resume (usually English).`;

  const { parsed, provider } = await llm.chatJson({
    temperature: 0.35,
    maxTokens: 5000,
    timeoutMs: 90000,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `JOB POSTING:\n${jobBlock}\n\nMASTER RESUME JSON:\n${JSON.stringify(masterResume)}`,
      },
    ],
  });

  const resumeRaw = parsed.resume || parsed;
  const tailored = normalizeResume(resumeRaw, masterResume.basics?.name);
  // Preserve contact identity from master
  if (masterResume.basics) {
    tailored.basics.name = masterResume.basics.name || tailored.basics.name;
    tailored.basics.email = masterResume.basics.email || tailored.basics.email;
    tailored.basics.phone = masterResume.basics.phone || tailored.basics.phone;
    tailored.basics.url = masterResume.basics.url || tailored.basics.url;
  }

  let changes = asArray(parsed.changes_summary || parsed.changes || parsed.summary_bullets)
    .map((c) => String(c).trim())
    .filter(Boolean)
    .slice(0, 8);

  if (!changes.length) {
    changes = [
      `Tailored summary and skills toward ${job.title || 'the role'}`,
      'Reordered experience to emphasize relevant work',
    ];
  }

  return {
    resume: tailored,
    changes_summary: changes.join('\n'),
    provider,
  };
}

let pdfmakeReady = false;

function ensurePdfmake() {
  let pdfmake;
  try {
    pdfmake = require('pdfmake');
  } catch {
    const err = new Error('pdfmake is not installed. Run: npm install pdfmake');
    err.status = 500;
    throw err;
  }
  if (!pdfmakeReady) {
    // Standard PDF fonts (ANSI) — no TTF files required
    pdfmake.addFonts({
      Helvetica: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique',
      },
    });
    // We only write local files we control; allow write path without noisy warnings
    if (typeof pdfmake.setLocalAccessPolicy === 'function') {
      pdfmake.setLocalAccessPolicy((url) => true);
    }
    if (typeof pdfmake.setUrlAccessPolicy === 'function') {
      pdfmake.setUrlAccessPolicy(() => false);
    }
    pdfmakeReady = true;
  }
  return pdfmake;
}

/**
 * Render JSON Resume to PDF with pdfmake (ATS-friendly single column).
 */
async function renderResumePdf(resume, outPath) {
  const pdfmake = ensurePdfmake();
  const r = normalizeResume(resume);
  const b = r.basics || {};
  const locParts = [b.location?.city, b.location?.region, b.location?.countryCode].filter(Boolean);
  const contactLine = [b.email, b.phone, b.url, locParts.join(', ')].filter(Boolean).join('  ·  ');

  const content = [];

  content.push({
    text: b.name || 'Resume',
    style: 'name',
  });
  if (b.label) {
    content.push({ text: b.label, style: 'label' });
  }
  if (contactLine) {
    content.push({ text: contactLine, style: 'contact', margin: [0, 2, 0, 10] });
  }

  if (b.summary) {
    content.push({ text: 'SUMMARY', style: 'section' });
    content.push({ text: b.summary, style: 'body', margin: [0, 0, 0, 10] });
  }

  if (r.skills?.length) {
    content.push({ text: 'SKILLS', style: 'section' });
    const skillText = r.skills
      .map((s) => {
        const k = s.keywords?.length ? ` (${s.keywords.join(', ')})` : '';
        return s.name + k;
      })
      .join('  ·  ');
    content.push({ text: skillText, style: 'body', margin: [0, 0, 0, 10] });
  }

  if (r.work?.length) {
    content.push({ text: 'EXPERIENCE', style: 'section' });
    for (const w of r.work) {
      const dates = [w.startDate, w.endDate || 'Present'].filter(Boolean).join(' – ');
      content.push({
        columns: [
          {
            text: [
              { text: w.position || 'Role', bold: true },
              w.name ? { text: `  ·  ${w.name}` } : {},
            ],
            width: '*',
          },
          { text: dates, alignment: 'right', width: 120, style: 'dates' },
        ],
        margin: [0, 4, 0, 2],
      });
      if (w.summary) {
        content.push({ text: w.summary, style: 'body', margin: [0, 0, 0, 2] });
      }
      if (w.highlights?.length) {
        content.push({
          ul: w.highlights,
          style: 'body',
          margin: [0, 0, 0, 6],
        });
      }
    }
  }

  if (r.projects?.length) {
    content.push({ text: 'PROJECTS', style: 'section', margin: [0, 6, 0, 0] });
    for (const p of r.projects) {
      content.push({ text: p.name, bold: true, margin: [0, 4, 0, 1] });
      if (p.description) {
        content.push({ text: p.description, style: 'body' });
      }
      if (p.highlights?.length) {
        content.push({ ul: p.highlights, style: 'body', margin: [0, 0, 0, 4] });
      }
    }
  }

  if (r.education?.length) {
    content.push({ text: 'EDUCATION', style: 'section', margin: [0, 6, 0, 0] });
    for (const e of r.education) {
      const degree = [e.studyType, e.area].filter(Boolean).join(', ');
      const dates = [e.startDate, e.endDate].filter(Boolean).join(' – ');
      content.push({
        columns: [
          {
            text: [
              { text: e.institution || 'School', bold: true },
              degree ? { text: `\n${degree}` } : {},
            ],
            width: '*',
          },
          { text: dates, alignment: 'right', width: 120, style: 'dates' },
        ],
        margin: [0, 3, 0, 3],
      });
    }
  }

  if (r.certificates?.length) {
    content.push({ text: 'CERTIFICATES', style: 'section', margin: [0, 6, 0, 0] });
    for (const c of r.certificates) {
      const line = [c.name, c.issuer, c.date].filter(Boolean).join(' · ');
      content.push({ text: line, style: 'body', margin: [0, 2, 0, 0] });
    }
  }

  if (r.languages?.length) {
    content.push({ text: 'LANGUAGES', style: 'section', margin: [0, 6, 0, 0] });
    content.push({
      text: r.languages
        .map((l) => (l.fluency ? `${l.language} (${l.fluency})` : l.language))
        .join('  ·  '),
      style: 'body',
    });
  }

  const docDefinition = {
    content,
    defaultStyle: {
      font: 'Helvetica',
      fontSize: 10,
      color: '#1a1a1a',
      lineHeight: 1.25,
    },
    styles: {
      name: { fontSize: 18, bold: true, margin: [0, 0, 0, 2] },
      label: { fontSize: 11, color: '#444', margin: [0, 0, 0, 2] },
      contact: { fontSize: 9, color: '#555' },
      section: {
        fontSize: 11,
        bold: true,
        color: '#111',
        margin: [0, 8, 0, 4],
        characterSpacing: 0.5,
      },
      body: { fontSize: 10 },
      dates: { fontSize: 9, color: '#555' },
    },
    pageMargins: [48, 48, 48, 48],
  };

  const pdf = pdfmake.createPdf(docDefinition);
  await pdf.write(outPath);
  return outPath;
}

/**
 * Rate limit: max N tailor requests per hour per user.
 */
async function assertTailorRateLimit(userId, maxPerHour = 5) {
  const r = await db.query(
    `
    SELECT COUNT(*)::int AS n
    FROM tailored_resumes
    WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'
    `,
    [userId]
  );
  if ((r.rows[0]?.n || 0) >= maxPerHour) {
    const err = new Error(`Resume tailor limit reached (${maxPerHour}/hour). Try again later.`);
    err.status = 429;
    err.code = 'RATE_LIMIT';
    throw err;
  }
}

/**
 * Prune old tailored files for a user.
 */
async function pruneTailored(userId) {
  const keep = TAILORED_KEEP();
  const old = await db.query(
    `
    SELECT id, file_path FROM tailored_resumes
    WHERE user_id = $1
    ORDER BY created_at DESC
    OFFSET $2
    `,
    [userId, keep]
  );
  for (const row of old.rows) {
    if (row.file_path && fs.existsSync(row.file_path)) {
      try {
        fs.unlinkSync(row.file_path);
      } catch {
        /* ignore */
      }
    }
    await db.query('DELETE FROM tailored_resumes WHERE id = $1', [row.id]);
  }
}

/**
 * Full pipeline: ensure master → tailor → PDF → DB row.
 * @param {string} userId
 * @param {string} jobId
 */
async function tailorAndSave(userId, jobId) {
  await assertTailorRateLimit(userId);

  const jobResult = await db.query(
    `
    SELECT id, title, company_name, location, job_type, description, slug, status
    FROM jobs WHERE id = $1
    `,
    [jobId]
  );
  const job = jobResult.rows[0];
  if (!job) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }

  const { resume: master } = await ensureMasterResume(userId);
  const { resume: tailored, changes_summary, provider } = await tailorResumeJson(master, job);

  const dir = tailoredDir(userId);
  const safeCompany = String(job.company_name || 'company')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 40);
  const fileName = `tailored-${safeCompany}-${Date.now()}.pdf`;
  const filePath = path.join(dir, fileName);

  await renderResumePdf(tailored, filePath);

  const originalName = `CV_${safeCompany}_${String(job.title || 'role')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 40)}.pdf`;

  const insert = await db.query(
    `
    INSERT INTO tailored_resumes (
      id, user_id, job_id, job_title, company_name,
      file_path, original_name, changes_summary, tailored_json
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    RETURNING id, user_id, job_id, job_title, company_name, original_name,
              changes_summary, created_at
    `,
    [
      uuidv4(),
      userId,
      job.id,
      job.title,
      job.company_name,
      filePath,
      originalName,
      changes_summary,
      JSON.stringify(tailored),
    ]
  );

  await pruneTailored(userId);

  const row = insert.rows[0];
  return {
    ...row,
    file_path: filePath,
    provider,
    download_path: `/api/users/resume/tailored/${row.id}/download`,
  };
}

/**
 * Candidate jobs for /resume and profile UI: saved + matching prefs.
 */
async function getResumeCandidates(userId, limit = 8) {
  const max = Math.min(Math.max(limit, 1), 20);
  const userResult = await db.query(
    `
    SELECT id, preferred_categories, preferred_locations, preferred_job_types,
           skills, profile_keywords
    FROM users WHERE id = $1
    `,
    [userId]
  );
  const user = userResult.rows[0];
  if (!user) return [];

  const seen = new Set();
  const out = [];

  const saved = await db.query(
    `
    SELECT j.id, j.title, j.company_name, j.location, j.job_type, j.posted_date, j.slug,
           'saved' AS source
    FROM saved_jobs s
    JOIN jobs j ON j.id = s.job_id
    WHERE s.user_id = $1 AND j.status = 'active'
    ORDER BY s.saved_at DESC
    LIMIT $2
    `,
    [userId, max]
  );
  for (const row of saved.rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }

  if (out.length < max) {
    try {
      const criteria = criteriaFromPreferences(user);
      const { jobs } = await findMatchingJobsWithFallback(criteria, null, {
        limit: max,
        ignoreLastSent: true,
      });
      for (const j of jobs || []) {
        if (seen.has(j.id)) continue;
        seen.add(j.id);
        out.push({
          id: j.id,
          title: j.title,
          company_name: j.company_name,
          location: j.location,
          job_type: j.job_type,
          posted_date: j.posted_date,
          slug: j.slug,
          source: 'match',
        });
        if (out.length >= max) break;
      }
    } catch (error) {
      console.warn('resume candidates match failed:', error.message);
    }
  }

  // Fallback: newest active jobs
  if (out.length < 3) {
    const recent = await db.query(
      `
      SELECT id, title, company_name, location, job_type, posted_date, slug,
             'recent' AS source
      FROM jobs
      WHERE status = 'active'
      ORDER BY posted_date DESC NULLS LAST
      LIMIT $1
      `,
      [max]
    );
    for (const row of recent.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
      if (out.length >= max) break;
    }
  }

  return out.slice(0, max);
}

async function listTailored(userId, limit = 30) {
  const r = await db.query(
    `
    SELECT id, job_id, job_title, company_name, original_name, changes_summary, created_at
    FROM tailored_resumes
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [userId, Math.min(limit, 50)]
  );
  return r.rows;
}

async function getTailoredForUser(userId, tailoredId) {
  const r = await db.query(
    `
    SELECT * FROM tailored_resumes
    WHERE id = $1 AND user_id = $2
    `,
    [tailoredId, userId]
  );
  return r.rows[0] || null;
}

async function deleteTailored(userId, tailoredId) {
  const row = await getTailoredForUser(userId, tailoredId);
  if (!row) return false;
  if (row.file_path && fs.existsSync(row.file_path)) {
    try {
      fs.unlinkSync(row.file_path);
    } catch {
      /* ignore */
    }
  }
  await db.query('DELETE FROM tailored_resumes WHERE id = $1 AND user_id = $2', [
    tailoredId,
    userId,
  ]);
  return true;
}

module.exports = {
  ensureMasterResume,
  tailorResumeJson,
  renderResumePdf,
  tailorAndSave,
  getResumeCandidates,
  listTailored,
  getTailoredForUser,
  deleteTailored,
  normalizeResume,
  isLlmConfigured: () => llm.isConfigured(),
};
