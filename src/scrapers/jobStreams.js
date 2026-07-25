/**
 * Shared job discovery streams — titles × locations balanced across career fields.
 * Used by RapidAPI importers and documented for n8n query planners.
 */

const LOCATIONS = [
  { query: 'Kenya', country: 'ke' },
  { query: 'Nairobi', country: 'ke' },
  { query: 'United States', country: 'us' },
  { query: 'United Kingdom', country: 'gb' },
  { query: 'Germany', country: 'de' },
  { query: 'South Africa', country: 'za' },
  { query: 'remote', country: 'us', workFromHome: true },
];

/** Balanced title queries with category hints (slug) */
const TITLES = [
  // Healthcare
  { query: 'registered nurse', categoryHint: 'healthcare' },
  { query: 'clinical officer', categoryHint: 'healthcare' },
  { query: 'pharmacist', categoryHint: 'healthcare' },
  { query: 'medical laboratory technologist', categoryHint: 'healthcare' },
  { query: 'caregiver', categoryHint: 'healthcare' },
  // Education
  { query: 'primary school teacher', categoryHint: 'education' },
  { query: 'secondary school teacher', categoryHint: 'education' },
  { query: 'university lecturer', categoryHint: 'education' },
  { query: 'special needs teacher', categoryHint: 'education' },
  // Social work & NGO
  { query: 'social worker', categoryHint: 'social-work' },
  { query: 'community development officer', categoryHint: 'social-work' },
  { query: 'monitoring and evaluation officer', categoryHint: 'social-work' },
  { query: 'NGO program manager', categoryHint: 'social-work' },
  // Legal
  { query: 'lawyer', categoryHint: 'legal' },
  { query: 'legal officer', categoryHint: 'legal' },
  { query: 'paralegal', categoryHint: 'legal' },
  // Hospitality
  { query: 'hotel receptionist', categoryHint: 'hospitality' },
  { query: 'chef', categoryHint: 'hospitality' },
  { query: 'restaurant manager', categoryHint: 'hospitality' },
  { query: 'housekeeping supervisor', categoryHint: 'hospitality' },
  // Construction & trades
  { query: 'civil engineer', categoryHint: 'construction-trades' },
  { query: 'quantity surveyor', categoryHint: 'construction-trades' },
  { query: 'site supervisor construction', categoryHint: 'construction-trades' },
  { query: 'architect', categoryHint: 'construction-trades' },
  // Skilled trades
  { query: 'electrician', categoryHint: 'skilled-trades' },
  { query: 'plumber', categoryHint: 'skilled-trades' },
  { query: 'welder', categoryHint: 'skilled-trades' },
  { query: 'mechanic', categoryHint: 'skilled-trades' },
  // Manufacturing
  { query: 'production supervisor', categoryHint: 'manufacturing' },
  { query: 'quality control inspector', categoryHint: 'manufacturing' },
  { query: 'factory operator', categoryHint: 'manufacturing' },
  // Agriculture
  { query: 'farm manager', categoryHint: 'agriculture' },
  { query: 'agronomist', categoryHint: 'agriculture' },
  { query: 'agricultural extension officer', categoryHint: 'agriculture' },
  // Logistics
  { query: 'warehouse supervisor', categoryHint: 'logistics' },
  { query: 'logistics coordinator', categoryHint: 'logistics' },
  { query: 'truck driver', categoryHint: 'logistics' },
  { query: 'supply chain manager', categoryHint: 'logistics' },
  // Retail
  { query: 'retail store manager', categoryHint: 'retail' },
  { query: 'cashier', categoryHint: 'retail' },
  { query: 'merchandiser', categoryHint: 'retail' },
  // Media
  { query: 'journalist', categoryHint: 'media-communications' },
  { query: 'content writer', categoryHint: 'media-communications' },
  { query: 'communications officer', categoryHint: 'media-communications' },
  // Government
  { query: 'public health officer', categoryHint: 'government' },
  { query: 'administrative officer government', categoryHint: 'government' },
  { query: 'civil servant', categoryHint: 'government' },
  // Science
  { query: 'research scientist', categoryHint: 'science-research' },
  { query: 'lab technician', categoryHint: 'science-research' },
  // Office / professional (existing coverage)
  { query: 'accountant', categoryHint: 'finance' },
  { query: 'financial analyst', categoryHint: 'finance' },
  { query: 'human resources officer', categoryHint: 'human-resources' },
  { query: 'recruiter', categoryHint: 'human-resources' },
  { query: 'sales representative', categoryHint: 'sales' },
  { query: 'business development manager', categoryHint: 'sales' },
  { query: 'digital marketing manager', categoryHint: 'marketing' },
  { query: 'customer service representative', categoryHint: 'customer-support' },
  { query: 'customer success manager', categoryHint: 'customer-support' },
  { query: 'operations manager', categoryHint: 'operations' },
  { query: 'project manager', categoryHint: 'operations' },
  { query: 'product manager', categoryHint: 'product' },
  { query: 'ui ux designer', categoryHint: 'design' },
  { query: 'graphic designer', categoryHint: 'design' },
  // Tech (still included, not dominant)
  { query: 'software engineer', categoryHint: 'software-development' },
  { query: 'full stack developer', categoryHint: 'software-development' },
  { query: 'data analyst', categoryHint: 'data-science' },
  { query: 'data scientist', categoryHint: 'data-science' },
  { query: 'devops engineer', categoryHint: 'devops' },
  { query: 'IT support specialist', categoryHint: 'devops' },
];

/**
 * Flat string list for APIs that only accept title strings.
 */
function titleQueries() {
  return TITLES.map((t) => t.query);
}

/**
 * Title → categoryHint lookup (case-insensitive).
 */
function hintForTitle(title) {
  const key = String(title || '').toLowerCase().trim();
  const found = TITLES.find((t) => t.query.toLowerCase() === key);
  return found ? found.categoryHint : undefined;
}

/**
 * Location strings for LinkedIn-style OR filters.
 */
function linkedInLocationOr() {
  return LOCATIONS
    .filter((l) => !l.workFromHome)
    .map((l) => `"${l.query}"`)
    .join(' OR ');
}

/**
 * JobsAPI14-style { query, location, countryCode } pairs (sampled matrix).
 */
function api14Queries() {
  const pairs = [];
  const locs = [
    { location: 'Kenya', countryCode: 'ke' },
    { location: 'United States', countryCode: 'us' },
    { location: 'United Kingdom', countryCode: 'gb' },
    { location: 'South Africa', countryCode: 'za' },
  ];
  // Pair each title with rotating locations for coverage without explosion
  TITLES.forEach((t, i) => {
    const loc = locs[i % locs.length];
    pairs.push({
      query: t.query,
      location: loc.location,
      countryCode: loc.countryCode,
      categoryHint: t.categoryHint,
    });
  });
  return pairs;
}

module.exports = {
  LOCATIONS,
  TITLES,
  titleQueries,
  hintForTitle,
  linkedInLocationOr,
  api14Queries,
};
