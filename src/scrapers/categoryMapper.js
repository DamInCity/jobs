/**
 * Map free-text titles / taxonomies onto seeded category slugs.
 */

const TAXONOMY_TO_SLUG = {
  technology: 'software-development',
  software: 'software-development',
  engineering: 'software-development',
  'data & analytics': 'data-science',
  'data and analytics': 'data-science',
  'data science': 'data-science',
  design: 'design',
  marketing: 'marketing',
  sales: 'sales',
  'customer service & support': 'customer-support',
  'customer service and support': 'customer-support',
  'customer support': 'customer-support',
  'finance & accounting': 'finance',
  'finance and accounting': 'finance',
  finance: 'finance',
  accounting: 'finance',
  'human resources': 'human-resources',
  hr: 'human-resources',
  product: 'product',
  'product management': 'product',
  operations: 'operations',
  devops: 'devops',
  'it services': 'devops',
  consulting: 'other',
  healthcare: 'healthcare',
  health: 'healthcare',
  medical: 'healthcare',
  nursing: 'healthcare',
  education: 'education',
  teaching: 'education',
  'social work': 'social-work',
  'social services': 'social-work',
  ngo: 'social-work',
  legal: 'legal',
  law: 'legal',
  hospitality: 'hospitality',
  hotel: 'hospitality',
  restaurant: 'hospitality',
  'food, beverage and hospitality': 'hospitality',
  'food beverage and hospitality': 'hospitality',
  government: 'government',
  construction: 'construction-trades',
  trades: 'skilled-trades',
  manufacturing: 'manufacturing',
  agriculture: 'agriculture',
  farming: 'agriculture',
  logistics: 'logistics',
  warehouse: 'logistics',
  'supply chain': 'logistics',
  retail: 'retail',
  media: 'media-communications',
  communications: 'media-communications',
  journalism: 'media-communications',
  government: 'government',
  'public sector': 'government',
  science: 'science-research',
  research: 'science-research',
  'management & leadership': 'operations',
  'management and leadership': 'operations',
};

const TITLE_RULES = [
  {
    slug: 'healthcare',
    patterns: /\b(nurse|nursing|doctor|physician|pharmacist|clinical\s+officer|caregiver|care\s+aide|midwife|dentist|physiotherapist|radiographer|medical\s+officer|healthcare|hospital\s+admin)\b/i,
  },
  {
    slug: 'education',
    patterns: /\b(teacher|teaching|lecturer|tutor|professor|headteacher|principal|curriculum|education\s+officer|school\s+admin|special\s+needs|instructor)\b/i,
  },
  {
    slug: 'social-work',
    patterns: /\b(social\s+worker|case\s+worker|community\s+development|monitoring\s+and\s+evaluation|\bm&e\b|ngo|humanitarian|child\s+protection|counsellor|counselor)\b/i,
  },
  {
    slug: 'legal',
    patterns: /\b(lawyer|advocate|attorney|legal\s+officer|paralegal|solicitor|compliance\s+officer|legal\s+counsel)\b/i,
  },
  {
    slug: 'hospitality',
    patterns: /\b(chef|cook|hotel|receptionist|housekeeping|waiter|waitress|barista|restaurant\s+manager|hospitality|front\s+desk|concierge)\b/i,
  },
  {
    slug: 'construction-trades',
    patterns: /\b(civil\s+engineer|quantity\s+surveyor|site\s+supervisor|construction|architect|structural\s+engineer|building\s+surveyor|foreman)\b/i,
  },
  {
    slug: 'skilled-trades',
    patterns: /\b(electrician|plumber|plumbing|welder|welding|carpenter|mechanic|mason|fitter|hvac|fabrication|tannery|leather\s+work|hair\s+dressing|beauty\s+therapy|cosmetology|clothing\s+technology|textile)\b/i,
  },
  {
    slug: 'manufacturing',
    patterns: /\b(production\s+supervisor|factory|manufacturing|quality\s+control|machine\s+operator|assembly\s+line|plant\s+manager)\b/i,
  },
  {
    slug: 'agriculture',
    patterns: /\b(farm\s+manager|agronomist|agriculture|agricultural|horticultur|livestock|veterinary|vet\s+officer)\b/i,
  },
  {
    slug: 'logistics',
    patterns: /\b(warehouse|logistics|supply\s+chain|truck\s+driver|fleet|dispatcher|freight|procurement\s+officer|inventory)\b/i,
  },
  {
    slug: 'retail',
    patterns: /\b(retail|store\s+manager|cashier|merchandiser|shop\s+assistant|sales\s+associate)\b/i,
  },
  {
    slug: 'media-communications',
    patterns: /\b(journalist|reporter|editor|content\s+writer|communications\s+officer|public\s+relations|\bpr\b|copywriter|broadcaster)\b/i,
  },
  {
    slug: 'government',
    patterns: /\b(civil\s+servant|public\s+health\s+officer|government|county\s+government|administrative\s+officer|public\s+sector|municipal|public\s+service|foreign\s+service|cadet|third\s+secretary)\b/i,
  },
  {
    slug: 'science-research',
    patterns: /\b(research\s+scientist|lab\s+technician|laboratory|research\s+assistant|biologist|chemist|scientist)\b/i,
  },
  {
    slug: 'software-development',
    patterns: /\b(software|full[\s-]?stack|front[\s-]?end|back[\s-]?end|developer|programmer|mobile\s+developer|android|ios|react|node\.?js|java\s+developer|python\s+developer|golang|rust\s+engineer)\b/i,
  },
  {
    slug: 'data-science',
    patterns: /\b(data\s+scientist|data\s+engineer|machine\s+learning|ml\s+engineer|ai\s+engineer|data\s+analyst|analytics|bi\s+developer|business\s+intelligence)\b/i,
  },
  {
    slug: 'devops',
    patterns: /\b(devops|sre|site\s+reliability|platform\s+engineer|cloud\s+engineer|infrastructure|kubernetes|aws\s+engineer|it\s+support|system\s+admin)\b/i,
  },
  {
    slug: 'design',
    patterns: /\b(ui\/ux|ux\s+designer|ui\s+designer|product\s+designer|graphic\s+designer|visual\s+designer)\b/i,
  },
  {
    slug: 'product',
    patterns: /\b(product\s+manager|product\s+owner|product\s+lead)\b/i,
  },
  {
    slug: 'marketing',
    patterns: /\b(marketing|seo\b|growth\s+manager|brand\s+manager|social\s+media\s+manager|digital\s+marketing)\b/i,
  },
  {
    slug: 'sales',
    patterns: /\b(sales\s+representative|account\s+executive|business\s+development|\bbdr\b|\bsdr\b|account\s+manager)\b/i,
  },
  {
    slug: 'customer-support',
    patterns: /\b(customer\s+success|customer\s+support|customer\s+service|support\s+specialist|help\s+desk|service\s+desk)\b/i,
  },
  {
    slug: 'finance',
    patterns: /\b(finance|accountant|accounting|controller|auditor|bookkeeper|financial\s+analyst)\b/i,
  },
  {
    slug: 'human-resources',
    patterns: /\b(human\s+resources|\bhr\b|recruiter|talent\s+acquisition|people\s+operations|hr\s+officer)\b/i,
  },
  {
    slug: 'operations',
    patterns: /\b(operations\s+manager|project\s+manager|program\s+manager|scrum\s+master)\b/i,
  },
];

const KNOWN_SLUGS = new Set([
  'software-development',
  'design',
  'marketing',
  'sales',
  'customer-support',
  'finance',
  'human-resources',
  'data-science',
  'devops',
  'product',
  'operations',
  'other',
  'healthcare',
  'education',
  'social-work',
  'legal',
  'hospitality',
  'construction-trades',
  'manufacturing',
  'agriculture',
  'logistics',
  'retail',
  'media-communications',
  'government',
  'science-research',
  'skilled-trades',
]);

/**
 * @param {object} options
 * @param {string} [options.title]
 * @param {string|string[]} [options.taxonomies]
 * @param {string} [options.explicit] - already a slug or category name
 * @returns {string} category slug
 */
function mapCategory({ title = '', taxonomies = [], explicit } = {}) {
  if (explicit) {
    const normalized = String(explicit).toLowerCase().trim().replace(/\s+/g, '-');
    if (KNOWN_SLUGS.has(normalized)) return normalized;
    if (TAXONOMY_TO_SLUG[String(explicit).toLowerCase().trim()]) {
      return TAXONOMY_TO_SLUG[String(explicit).toLowerCase().trim()];
    }
  }

  const taxList = Array.isArray(taxonomies)
    ? taxonomies
    : taxonomies
      ? [taxonomies]
      : [];

  for (const tax of taxList) {
    const key = String(tax || '').toLowerCase().trim();
    if (TAXONOMY_TO_SLUG[key]) return TAXONOMY_TO_SLUG[key];
    const asSlug = key.replace(/\s+/g, '-');
    if (KNOWN_SLUGS.has(asSlug)) return asSlug;
  }

  for (const rule of TITLE_RULES) {
    if (rule.patterns.test(title)) return rule.slug;
  }

  return 'other';
}

module.exports = { mapCategory, TAXONOMY_TO_SLUG, KNOWN_SLUGS, TITLE_RULES };
