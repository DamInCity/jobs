/**
 * Deterministic ATS pipeline — selection + score.
 * The LLM only rewrites prose; it must not choose the skill list.
 */

const MAX_SKILLS = 15;
const MIN_SKILLS = 8;

const SOFT = new Set([
  'communication',
  'teamwork',
  'leadership',
  'stakeholder',
  'stakeholder management',
  'stakeholder communication',
  'coordination',
  'problem solving',
  'time management',
  'attention to detail',
  'multitasking',
]);

const CLUSTERS = [
  {
    id: 'linux',
    re: /\b(linux|ubuntu|debian|unix|sysadmin|system administration|operating systems?)\b/i,
  },
  {
    id: 'network',
    re: /\b(network|networking|cisco|routing|switching|tcp\/?ip|lan|wan)\b/i,
  },
  {
    id: 'security',
    re: /\b(security|firewall|access control|secure configuration)\b/i,
  },
  {
    id: 'script',
    re: /\b(python|bash|javascript|js|automation|scripting|command-?line)\b/i,
  },
  {
    id: 'web',
    re: /\b(website|web design|web development|html|css|seo|wordpress|cms)\b/i,
  },
  {
    id: 'data',
    re: /\b(data analysis|reporting|gis|excel|analytics)\b/i,
  },
  {
    id: 'comms',
    re: /\b(stakeholder|communication|coordination|client-facing)\b/i,
  },
  {
    id: 'marketing',
    re: /\b(marketing|campaign|content systems?|digital platforms)\b/i,
  },
  {
    id: 'media',
    re: /\b(photography|videography|graphics? design)\b/i,
  },
];

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9+/.#& -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clusterOf(text) {
  const n = String(text || '');
  for (const c of CLUSTERS) {
    if (c.re.test(n)) return c.id;
  }
  return null;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function masterCorpus(master) {
  const parts = [];
  const b = master?.basics || {};
  parts.push(b.summary, b.label);
  for (const w of master?.work || []) {
    parts.push(w.position, w.name, w.summary, ...(w.highlights || []));
  }
  for (const p of master?.projects || []) {
    parts.push(p.name, p.description, ...(p.highlights || []));
  }
  for (const s of master?.skills || []) {
    parts.push(typeof s === 'string' ? s : s.name, ...((s && s.keywords) || []));
  }
  return normalize(parts.filter(Boolean).join(' \n '));
}

function flattenMasterSkills(master) {
  const out = [];
  for (const s of master?.skills || []) {
    if (typeof s === 'string') {
      out.push({ name: s.trim(), keywords: [], source: 'master' });
      continue;
    }
    const name = String(s?.name || '').trim();
    const keywords = (s?.keywords || []).map((k) => String(k).trim()).filter(Boolean);
    if (name) out.push({ name, keywords, source: 'master' });
    for (const k of keywords) {
      out.push({ name: k, keywords: [], source: 'keyword', parent: name });
    }
  }
  return out;
}

/**
 * Pull JD terms. Rules only — no LLM (stays stable across openrouter/free).
 */
function extractJdTerms(job = {}) {
  const title = String(job.title || '');
  const body = stripHtml(job.description || '');
  const blob = `${title}\n${body}`;
  const lower = normalize(blob);

  const phraseRe =
    /\b([A-Z][A-Za-z0-9.+#-]{1,}(?:\s+[A-Za-z0-9.+#-]{2,}){0,3}|linux|python|javascript|bash|cisco|seo|gis|html|css|sql|excel|aws|azure|docker)\b/g;
  const counts = new Map();
  let m;
  const scan = `${title} ${title} ${body}`;
  while ((m = phraseRe.exec(scan))) {
    const raw = m[1].trim();
    if (raw.length < 2) continue;
    const key = normalize(raw);
    if (key.length < 2 || /^(the|and|for|with|from|this|that|your|our|you|are|will)$/.test(key)) {
      continue;
    }
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const requiredHint = /\b(required|must have|minimum|mandatory|essential)\b[\s\S]{0,280}/gi;
  const requiredBlock = [];
  let r;
  while ((r = requiredHint.exec(blob))) {
    requiredBlock.push(normalize(r[0]));
  }
  const requiredText = requiredBlock.join(' ');

  const tier1 = [];
  const tier2 = [];
  const titleNorm = normalize(title);
  for (const [term, n] of counts) {
    const inTitle = titleNorm.includes(term);
    const inRequired = requiredText.includes(term);
    const rec = { term, count: n, inTitle, inRequired };
    if (inTitle || inRequired || n >= 3) tier1.push(rec);
    else tier2.push(rec);
  }

  const byCount = (a, b) => b.count - a.count || a.term.localeCompare(b.term);
  tier1.sort(byCount);
  tier2.sort(byCount);

  return {
    title,
    text: lower,
    tier1: tier1.slice(0, 20),
    tier2: tier2.slice(0, 30),
    raw: blob.slice(0, 8000),
  };
}

function termHits(haystack, term) {
  if (!term) return false;
  return haystack.includes(term);
}

function skillScore(item, jd, corpus) {
  const name = normalize(item.name);
  const blob = normalize([item.name, ...(item.keywords || [])].join(' '));
  let score = 0;
  let matchedTerm = null;
  for (const t of jd.tier1) {
    if (blob.includes(t.term) || t.term.includes(name)) {
      score += 8 + Math.min(t.count, 5);
      matchedTerm = matchedTerm || t.term;
    }
  }
  for (const t of jd.tier2) {
    if (blob.includes(t.term) || t.term.includes(name)) {
      score += 2;
      matchedTerm = matchedTerm || t.term;
    }
  }
  const evidenced = termHits(corpus, name) || (item.keywords || []).some((k) => termHits(corpus, normalize(k)));
  if (evidenced) score += 2;
  if (SOFT.has(name) && !jd.text.includes(name)) score -= 20;
  return { score, matchedTerm, evidenced, cluster: clusterOf(item.name) || clusterOf(blob) };
}

/**
 * Pick 8–15 skills. Prefer JD wording. Collapse clusters.
 */
function selectSkills(master, job) {
  const jd = extractJdTerms(job);
  const corpus = masterCorpus(master);
  const candidates = flattenMasterSkills(master).map((item) => {
    const meta = skillScore(item, jd, corpus);
    const label = meta.matchedTerm
      ? prettyLabel(meta.matchedTerm, item.name)
      : item.name;
    return { ...item, ...meta, label };
  });

  candidates.sort((a, b) => b.score - a.score);
  const picked = [];
  const usedCluster = new Set();
  const usedLabel = new Set();

  function tryAdd(c) {
    if (c.score <= 0 && picked.length >= MIN_SKILLS) return false;
    if (SOFT.has(normalize(c.label)) && !jd.text.includes(normalize(c.label))) return false;
    const key = normalize(c.label);
    if (usedLabel.has(key)) return false;
    if (c.cluster && usedCluster.has(c.cluster)) return false;
    if (!c.evidenced && !c.matchedTerm) return false;
    usedLabel.add(key);
    if (c.cluster) usedCluster.add(c.cluster);
    picked.push({
      name: c.label.slice(0, 80),
      keywords: [],
      cluster: c.cluster,
    });
    return true;
  }

  for (const c of candidates) {
    if (picked.length >= MAX_SKILLS) break;
    if (c.score >= 8 && c.matchedTerm) tryAdd(c);
  }
  for (const c of candidates) {
    if (picked.length >= MIN_SKILLS) break;
    if (c.score >= 2 && c.evidenced && c.source === 'master') tryAdd(c);
  }

  return {
    skills: picked.slice(0, MAX_SKILLS),
    jd,
    stats: {
      considered: candidates.length,
      picked: picked.length,
    },
  };
}

function prettyLabel(term, fallback) {
  const t = String(term || '').trim();
  if (!t) return fallback;
  if (t === t.toLowerCase() && t.length <= 4) return t.toUpperCase() === t ? t : fallback;
  return t.replace(/\b([a-z])/g, (ch) => ch.toUpperCase());
}

function resumePlain(resume) {
  const parts = [];
  parts.push(resume?.basics?.summary);
  for (const s of resume?.skills || []) {
    parts.push(typeof s === 'string' ? s : `${s.name} ${(s.keywords || []).join(' ')}`);
  }
  for (const w of resume?.work || []) {
    parts.push(w.summary, ...(w.highlights || []));
  }
  return normalize(parts.filter(Boolean).join(' '));
}

function scoreTailored(resume, job, selection) {
  const jd = selection?.jd || extractJdTerms(job);
  const text = resumePlain(resume);
  const skillCount = (resume?.skills || []).length;
  const tier1 = jd.tier1.slice(0, 14);
  const hits = tier1.filter((t) => text.includes(t.term)).length;
  const clusters = new Set(
    (resume?.skills || []).map((s) => clusterOf(typeof s === 'string' ? s : s.name)).filter(Boolean)
  );
  const stuffing =
    skillCount > MAX_SKILLS || (resume?.skills || []).length - clusters.size > 6
      ? 'high'
      : skillCount > 12
        ? 'med'
        : 'low';

  return {
    coverage_hit: hits,
    coverage_total: Math.max(tier1.length, 1),
    skill_count: skillCount,
    stuffing,
    caption: `Match ${hits}/${Math.max(tier1.length, 1)} · ${skillCount} skills`,
  };
}

function lockSkills(resume, selection) {
  const next = { ...resume, skills: (selection?.skills || []).map((s) => ({ name: s.name, keywords: [] })) };
  return next;
}

function formatSkillsLine(skills) {
  return (skills || [])
    .map((s) => (typeof s === 'string' ? s : s.name))
    .filter(Boolean)
    .join(', ');
}

module.exports = {
  MAX_SKILLS,
  MIN_SKILLS,
  extractJdTerms,
  buildEvidenceMap: masterCorpus,
  selectSkills,
  scoreTailored,
  lockSkills,
  formatSkillsLine,
  clusterOf,
};
