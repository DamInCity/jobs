/**
 * CV text extraction + skill/category profiling.
 * Rule-based taxonomy by default; optional xAI (SpaceXAI) when XAI_API_KEY is set.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { mapCategory, TITLE_RULES, KNOWN_SLUGS } = require('../scrapers/categoryMapper');

const LOCATION_HINTS = [
  'nairobi',
  'mombasa',
  'kisumu',
  'nakuru',
  'eldoret',
  'kenya',
  'uganda',
  'tanzania',
  'rwanda',
  'ethiopia',
  'nigeria',
  'ghana',
  'south africa',
  'remote',
  'united states',
  'usa',
  'uk',
  'united kingdom',
  'london',
  'dubai',
  'uae',
];

const SENIORITY_PATTERNS = [
  { level: 'lead', re: /\b(lead|principal|head\s+of|director|chief)\b/i },
  { level: 'senior', re: /\b(senior|sr\.?|staff)\b/i },
  { level: 'mid', re: /\b(mid[\s-]?level|intermediate)\b/i },
  { level: 'junior', re: /\b(junior|jr\.?|entry[\s-]?level|graduate|intern)\b/i },
];

const SKILL_LEXICON = [
  // Software
  'javascript', 'typescript', 'python', 'java', 'kotlin', 'swift', 'golang', 'go',
  'react', 'vue', 'angular', 'node', 'nodejs', 'express', 'django', 'flask',
  'postgresql', 'mysql', 'mongodb', 'redis', 'docker', 'kubernetes', 'aws', 'azure',
  'gcp', 'linux', 'git', 'rest', 'graphql', 'ci/cd', 'terraform',
  // Data
  'sql', 'excel', 'power bi', 'tableau', 'pandas', 'numpy', 'machine learning',
  'data analysis', 'r', 'spark',
  // Healthcare
  'nursing', 'patient care', 'midwifery', 'pharmacy', 'clinical', 'triage',
  'medical records', 'first aid',
  // Education
  'curriculum', 'lesson planning', 'classroom management', 'special needs',
  // Trades
  'electrical', 'plumbing', 'welding', 'hvac', 'carpentry', 'masonry',
  // Business
  'accounting', 'bookkeeping', 'quickbooks', 'sap', 'crm', 'salesforce',
  'project management', 'agile', 'scrum', 'procurement', 'logistics',
  // Soft / general
  'communication', 'leadership', 'teamwork', 'customer service', 'negotiation',
  'report writing', 'monitoring and evaluation', 'm&e',
];

/**
 * Extract plain text from a CV file path.
 * @param {string} filePath
 * @returns {Promise<{ text: string, method: string }>}
 */
async function extractCvText(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('CV file not found');
  }

  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);

  if (ext === '.pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return { text: (result?.text || '').trim(), method: 'pdf-parse' };
    } finally {
      try {
        await parser.destroy();
      } catch {
        /* ignore */
      }
    }
  }

  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return { text: (result?.value || '').trim(), method: 'mammoth' };
  }

  if (ext === '.doc') {
    // Legacy .doc: best-effort binary strip (no free pure-JS Word 97 parser)
    const rough = buffer
      .toString('utf8')
      .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u024F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (rough.length < 80) {
      throw new Error('Legacy .doc format is limited — please re-upload as PDF or DOCX');
    }
    return { text: rough, method: 'doc-binary-strip' };
  }

  throw new Error('Unsupported CV format (use PDF or DOCX)');
}

/**
 * Score category slugs against free text using TITLE_RULES + mapCategory.
 * @param {string} text
 * @returns {{ slug: string, score: number }[]}
 */
function scoreCategories(text) {
  const scores = new Map();
  const sample = String(text || '').slice(0, 50000);

  for (const rule of TITLE_RULES) {
    const matches = sample.match(new RegExp(rule.patterns.source, 'gi'));
    if (matches && matches.length) {
      scores.set(rule.slug, (scores.get(rule.slug) || 0) + matches.length);
    }
  }

  // Title-like first lines often hold the target role
  const firstLines = sample.split(/\n/).slice(0, 12).join(' ');
  const primary = mapCategory({ title: firstLines });
  if (primary && primary !== 'other') {
    scores.set(primary, (scores.get(primary) || 0) + 3);
  }

  return [...scores.entries()]
    .map(([slug, score]) => ({ slug, score }))
    .sort((a, b) => b.score - a.score);
}

function extractSkills(text) {
  const lower = String(text || '').toLowerCase();
  const found = [];
  for (const skill of SKILL_LEXICON) {
    const re = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(lower)) found.push(skill);
  }
  // Deduplicate preserving order
  return [...new Set(found)].slice(0, 25);
}

function extractLocations(text) {
  const lower = String(text || '').toLowerCase();
  const found = [];
  for (const loc of LOCATION_HINTS) {
    if (lower.includes(loc)) {
      // Prefer display form
      const display = loc
        .split(' ')
        .map((w) => (w === 'usa' || w === 'uk' || w === 'uae' ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(' ');
      found.push(display === 'Remote' ? 'Remote' : display);
    }
  }
  return [...new Set(found)].slice(0, 8);
}

function extractSeniority(text) {
  for (const { level, re } of SENIORITY_PATTERNS) {
    if (re.test(text)) return level;
  }
  return null;
}

function buildRuleProfile(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  const ranked = scoreCategories(cleaned);
  const categorySlugs = ranked.filter((r) => r.score >= 1).slice(0, 4).map((r) => r.slug);
  if (categorySlugs.length === 0) categorySlugs.push('other');

  const skills = extractSkills(cleaned);
  const locations = extractLocations(cleaned);
  const seniority = extractSeniority(cleaned);

  const topSlug = categorySlugs[0];
  const summaryParts = [
    seniority ? `${seniority}-level` : null,
    topSlug !== 'other' ? topSlug.replace(/-/g, ' ') : 'professional',
  ].filter(Boolean);

  let summary = `Profile suggests a ${summaryParts.join(' ')} background`;
  if (skills.length) {
    summary += ` with skills in ${skills.slice(0, 6).join(', ')}`;
  }
  summary += '.';

  return {
    category_slugs: categorySlugs,
    skills,
    preferred_locations: locations,
    seniority,
    keywords: skills.slice(0, 12),
    summary,
    method: 'rules',
    confidence: ranked[0] ? Math.min(0.95, 0.35 + ranked[0].score * 0.08) : 0.2,
  };
}

/**
 * Optional LLM refinement via xAI (SpaceXAI). Falls back to rule profile on failure.
 */
async function refineWithLlm(text, ruleProfile) {
  const apiKey = config.xai?.apiKey || process.env.XAI_API_KEY;
  if (!apiKey) return null;

  const model = config.xai?.model || process.env.XAI_MODEL || 'grok-4.5';
  const excerpt = String(text).slice(0, 12000);
  const allowed = [...KNOWN_SLUGS].join(', ');

  const system = `You profile job-seeker CVs. Reply with JSON only:
{"category_slugs":["slug",...],"skills":["..."],"preferred_locations":["..."],"seniority":"junior|mid|senior|lead|null","keywords":["..."],"summary":"1-2 sentences"}
category_slugs must be from: ${allowed}
Max 4 categories, max 20 skills. Prefer concrete tools/roles.`;

  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: `Rule baseline: ${JSON.stringify(ruleProfile)}\n\nCV text:\n${excerpt}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn(`CV LLM profile failed (${response.status}): ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await response.json();
    const content =
      data.choices?.[0]?.message?.content ||
      data.output_text ||
      '';
    const jsonMatch = String(content).match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);

    const slugs = (Array.isArray(parsed.category_slugs) ? parsed.category_slugs : [])
      .map((s) => String(s).toLowerCase().trim().replace(/\s+/g, '-'))
      .filter((s) => KNOWN_SLUGS.has(s))
      .slice(0, 4);

    return {
      category_slugs: slugs.length ? slugs : ruleProfile.category_slugs,
      skills: uniqueStrings(parsed.skills, 20),
      preferred_locations: uniqueStrings(parsed.preferred_locations, 8),
      seniority: ['junior', 'mid', 'senior', 'lead'].includes(parsed.seniority)
        ? parsed.seniority
        : ruleProfile.seniority,
      keywords: uniqueStrings(parsed.keywords || parsed.skills, 12),
      summary: String(parsed.summary || ruleProfile.summary).slice(0, 500),
      method: 'xai+rules',
      confidence: 0.85,
    };
  } catch (error) {
    console.warn('CV LLM profile error:', error.message);
    return null;
  }
}

function uniqueStrings(arr, max = 20) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))].slice(0, max);
}

/**
 * Full profile pipeline from file path.
 * @param {string} filePath
 * @returns {Promise<object>}
 */
async function profileCvFile(filePath) {
  const { text, method: extractMethod } = await extractCvText(filePath);
  if (!text || text.length < 40) {
    throw new Error('Could not extract enough text from CV');
  }

  const ruleProfile = buildRuleProfile(text);
  const llmProfile = await refineWithLlm(text, ruleProfile);
  const profile = llmProfile || ruleProfile;

  return {
    ...profile,
    extract_method: extractMethod,
    text_length: text.length,
    text_excerpt: text.slice(0, 500),
  };
}

module.exports = {
  extractCvText,
  buildRuleProfile,
  profileCvFile,
  scoreCategories,
  extractSkills,
};
