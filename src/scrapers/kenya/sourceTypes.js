/** Canonical source_type / verification values for JobsHub Kenya pack. */

const SOURCE_TYPES = Object.freeze({
  DIRECT: 'DIRECT',
  COMPANY_CAREER: 'COMPANY_CAREER',
  RECRUITMENT_AGENCY: 'RECRUITMENT_AGENCY',
  GOVERNMENT: 'GOVERNMENT',
  NGO: 'NGO',
  BOARD: 'BOARD',
  API: 'API',
  PARTNER: 'PARTNER',
  USER_SUBMITTED: 'USER_SUBMITTED',
});

const VERIFICATION = Object.freeze({
  VERIFIED: 'verified',
  AGGREGATED: 'aggregated',
  EXPIRED: 'expired',
  REJECTED: 'rejected',
});

/**
 * Map scraper name / board label → source_type.
 */
function inferSourceType(nameOrType) {
  const s = String(nameOrType || '').toUpperCase().replace(/[\s-]+/g, '_');
  if (SOURCE_TYPES[s]) return SOURCE_TYPES[s];
  const lower = String(nameOrType || '').toLowerCase();
  if (/jsearch|linkedin|jobsapi|rapid/i.test(lower)) return SOURCE_TYPES.API;
  if (/myjobmag|brightermonday|fuzu|board/i.test(lower)) return SOURCE_TYPES.BOARD;
  if (/gov|psc|county|parastatal|public/i.test(lower)) return SOURCE_TYPES.GOVERNMENT;
  if (/ngo|un |unicef|who |undp|relief/i.test(lower)) return SOURCE_TYPES.NGO;
  if (/recruit|agency/i.test(lower)) return SOURCE_TYPES.RECRUITMENT_AGENCY;
  if (/career|greenhouse|lever|workable|bamboo/i.test(lower)) return SOURCE_TYPES.COMPANY_CAREER;
  if (/manual|admin|direct/i.test(lower)) return SOURCE_TYPES.DIRECT;
  return SOURCE_TYPES.BOARD;
}

function defaultVerification(sourceType) {
  if (sourceType === SOURCE_TYPES.DIRECT) return VERIFICATION.VERIFIED;
  return VERIFICATION.AGGREGATED;
}

module.exports = {
  SOURCE_TYPES,
  VERIFICATION,
  inferSourceType,
  defaultVerification,
};
