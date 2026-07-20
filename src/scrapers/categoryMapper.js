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
  healthcare: 'other',
  'management & leadership': 'operations',
  'management and leadership': 'operations',
};

const TITLE_RULES = [
  { slug: 'software-development', patterns: /\b(software|full[\s-]?stack|front[\s-]?end|back[\s-]?end|developer|engineer|programmer|mobile|android|ios|react|node\.?js|java|python|golang|rust)\b/i },
  { slug: 'data-science', patterns: /\b(data scientist|data engineer|machine learning|ml engineer|ai engineer|analyst|analytics|bi developer)\b/i },
  { slug: 'devops', patterns: /\b(devops|sre|site reliability|platform engineer|cloud engineer|infrastructure|kubernetes|aws engineer)\b/i },
  { slug: 'design', patterns: /\b(ui\/ux|ux designer|ui designer|product designer|graphic designer|visual designer)\b/i },
  { slug: 'product', patterns: /\b(product manager|product owner|product lead)\b/i },
  { slug: 'marketing', patterns: /\b(marketing|seo|content writer|growth|brand manager|social media)\b/i },
  { slug: 'sales', patterns: /\b(sales|account executive|business development|bdr|sdr|account manager)\b/i },
  { slug: 'customer-support', patterns: /\b(customer success|customer support|support specialist|help desk|service desk)\b/i },
  { slug: 'finance', patterns: /\b(finance|accountant|accounting|controller|auditor|bookkeeper|financial analyst)\b/i },
  { slug: 'human-resources', patterns: /\b(human resources|\bhr\b|recruiter|talent acquisition|people operations)\b/i },
  { slug: 'operations', patterns: /\b(operations|project manager|program manager|scrum master|logistics)\b/i },
];

/**
 * @param {object} options
 * @param {string} [options.title]
 * @param {string|string[]} [options.taxonomies]
 * @param {string} [options.explicit] - already a slug or category name
 * @returns {string} category slug
 */
function mapCategory({ title = '', taxonomies = [], explicit } = {}) {
  if (explicit) {
    const normalized = String(explicit).toLowerCase().trim();
    if (normalized) return normalized.replace(/\s+/g, '-');
  }

  const taxList = Array.isArray(taxonomies)
    ? taxonomies
    : taxonomies
      ? [taxonomies]
      : [];

  for (const tax of taxList) {
    const key = String(tax || '').toLowerCase().trim();
    if (TAXONOMY_TO_SLUG[key]) return TAXONOMY_TO_SLUG[key];
  }

  for (const rule of TITLE_RULES) {
    if (rule.patterns.test(title)) return rule.slug;
  }

  return 'other';
}

module.exports = { mapCategory, TAXONOMY_TO_SLUG };
