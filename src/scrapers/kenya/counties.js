/**
 * Kenya county normalization helpers for JobsHub local listings.
 */

const COUNTIES = [
  'Baringo', 'Bomet', 'Bungoma', 'Busia', 'Elgeyo-Marakwet', 'Embu', 'Garissa',
  'Homa Bay', 'Isiolo', 'Kajiado', 'Kakamega', 'Kericho', 'Kiambu', 'Kilifi',
  'Kirinyaga', 'Kisii', 'Kisumu', 'Kitui', 'Kwale', 'Laikipia', 'Lamu', 'Machakos',
  'Makueni', 'Mandera', 'Marsabit', 'Meru', 'Migori', 'Mombasa', 'Murang\'a',
  'Nairobi', 'Nakuru', 'Nandi', 'Narok', 'Nyamira', 'Nyandarua', 'Nyeri',
  'Samburu', 'Siaya', 'Taita-Taveta', 'Tana River', 'Tharaka-Nithi', 'Trans Nzoia',
  'Turkana', 'Uasin Gishu', 'Vihiga', 'Wajir', 'West Pokot',
];

const ALIASES = {
  nairobi: 'Nairobi',
  'nairobi county': 'Nairobi',
  'nairobi cbd': 'Nairobi',
  'westlands': 'Nairobi',
  mombasa: 'Mombasa',
  msa: 'Mombasa',
  kisumu: 'Kisumu',
  nakuru: 'Nakuru',
  kiambu: 'Kiambu',
  machakos: 'Machakos',
  kajiado: 'Kajiado',
  eldoret: 'Uasin Gishu',
  'uasin gishu': 'Uasin Gishu',
  thika: 'Kiambu',
  malindi: 'Kilifi',
  kilifi: 'Kilifi',
  kwale: 'Kwale',
  kitale: 'Trans Nzoia',
  kericho: 'Kericho',
  nyeri: 'Nyeri',
  meru: 'Meru',
  embu: 'Embu',
  garissa: 'Garissa',
  kakamega: 'Kakamega',
  bungoma: 'Bungoma',
  busia: 'Busia',
  'homa bay': 'Homa Bay',
  homabay: 'Homa Bay',
  migori: 'Migori',
  kisii: 'Kisii',
  nyamira: 'Nyamira',
  nandi: 'Nandi',
  baringo: 'Baringo',
  laikipia: 'Laikipia',
  narok: 'Narok',
  bomet: 'Bomet',
  'trans nzoia': 'Trans Nzoia',
  'west pokot': 'West Pokot',
  turkana: 'Turkana',
  samburu: 'Samburu',
  isiolo: 'Isiolo',
  marsabit: 'Marsabit',
  mandera: 'Mandera',
  wajir: 'Wajir',
  'tana river': 'Tana River',
  lamu: 'Lamu',
  'taita taveta': 'Taita-Taveta',
  'taita-taveta': 'Taita-Taveta',
  'tharaka nithi': 'Tharaka-Nithi',
  'tharaka-nithi': 'Tharaka-Nithi',
  'elgeyo marakwet': 'Elgeyo-Marakwet',
  'elgeyo-marakwet': 'Elgeyo-Marakwet',
  vihiga: 'Vihiga',
  siaya: 'Siaya',
  muranga: 'Murang\'a',
  "murang'a": 'Murang\'a',
  kirinyaga: 'Kirinyaga',
  nyandarua: 'Nyandarua',
  makueni: 'Makueni',
  kitui: 'Kitui',
};

/**
 * Infer county from free-text location (+ optional hint).
 * @param {string} location
 * @param {string} [hint]
 * @returns {string|null}
 */
function normalizeCounty(location, hint) {
  if (hint) {
    const fromHint = matchCounty(String(hint));
    if (fromHint) return fromHint;
  }
  return matchCounty(String(location || ''));
}

function matchCounty(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (ALIASES[lower]) return ALIASES[lower];

  // Prefer longer county names first (e.g. Taita-Taveta before Taita)
  const sorted = [...COUNTIES].sort((a, b) => b.length - a.length);
  for (const county of sorted) {
    const re = new RegExp(`\\b${escapeRegExp(county)}\\b`, 'i');
    if (re.test(raw)) return county;
  }

  // Alias substring scan
  for (const [alias, county] of Object.entries(ALIASES)) {
    if (alias.length < 4) continue;
    if (lower.includes(alias)) return county;
  }

  return null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isKenyaLocation(location) {
  const s = String(location || '').toLowerCase();
  if (!s) return false;
  if (/\bkenya\b|\bke\b/.test(s)) return true;
  return Boolean(matchCounty(s));
}

module.exports = {
  COUNTIES,
  ALIASES,
  normalizeCounty,
  matchCounty,
  isKenyaLocation,
};
