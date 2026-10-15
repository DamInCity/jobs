const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  preprocessJob,
  normalizeJobType,
  inferJobType,
} = require('../src/scrapers/preprocessJob');

function sample(overrides = {}) {
  return {
    title: 'Accountant',
    company_name: 'Acme Kenya',
    external_link: 'https://acme.co.ke/jobs/accountant',
    posted_date: new Date(),
    ...overrides,
  };
}

describe('normalizeJobType', () => {
  test('defaults to onsite when type is missing', () => {
    assert.equal(normalizeJobType(undefined, { title: 'Accountant', location: 'Nairobi' }), 'onsite');
    assert.equal(normalizeJobType('', {}), 'onsite');
  });

  test('ignores job_is_remote when a physical city is present', () => {
    assert.equal(normalizeJobType(undefined, {
      title: 'Accountant',
      location: 'Nairobi, Kenya',
      job_is_remote: true,
    }), 'onsite');
  });

  test('trusts job_is_remote only when there is no physical location', () => {
    assert.equal(normalizeJobType(undefined, {
      title: 'Accountant',
      location: '',
      job_is_remote: true,
    }), 'remote');
  });

  test('detects workplace remote in the title', () => {
    assert.equal(normalizeJobType(undefined, {
      title: 'Software Engineer (Remote)',
      location: 'Nairobi, Kenya',
    }), 'remote');
    assert.equal(normalizeJobType(undefined, {
      title: 'Remote Software Engineer',
      location: 'Kenya',
    }), 'remote');
  });

  test('does not treat incidental remote as workplace type', () => {
    assert.equal(normalizeJobType(undefined, {
      title: 'Remote Sensing Analyst',
      location: 'Nairobi, Kenya',
    }), 'onsite');
    assert.equal(normalizeJobType(undefined, {
      title: 'Remote Area Nurse',
      location: 'Turkana, Kenya',
    }), 'onsite');
  });

  test('location Work from home is remote', () => {
    assert.equal(normalizeJobType(undefined, {
      title: 'Customer Support',
      location: 'Work from home',
    }), 'remote');
  });

  test('Nairobi (Remote) is remote', () => {
    assert.equal(normalizeJobType(undefined, {
      title: 'Product Manager',
      location: 'Nairobi (Remote)',
    }), 'remote');
  });

  test('hybrid wins when stated', () => {
    assert.equal(normalizeJobType('hybrid', { location: 'Nairobi' }), 'hybrid');
    assert.equal(normalizeJobType(undefined, { title: 'Designer', location: 'Nairobi, Hybrid' }), 'hybrid');
  });

  test('not remote / office-based stay onsite', () => {
    assert.equal(normalizeJobType(undefined, {
      title: 'Sales Executive (not remote)',
      location: 'Nairobi',
    }), 'onsite');
    assert.equal(normalizeJobType('office-based', { location: 'Mombasa' }), 'onsite');
  });

  test('strong description phrase marks remote', () => {
    assert.equal(normalizeJobType(undefined, {
      title: 'Backend Engineer',
      location: 'Kenya',
      description: 'This is a remote role. Work from anywhere in Kenya.',
    }), 'remote');
  });

  test('bare "remote communities" in description is not enough', () => {
    assert.equal(normalizeJobType(undefined, {
      title: 'Community Officer',
      location: 'Turkana, Kenya',
      description: 'You will serve remote communities across the county.',
    }), 'onsite');
  });

  test('explicit structured workplace field is honoured', () => {
    assert.equal(normalizeJobType('FULL_TIME, REMOTE', { location: 'Nairobi' }), 'remote');
    assert.equal(normalizeJobType(undefined, {
      location: 'Nairobi',
      work_arrangement: 'telecommute',
    }), 'remote');
  });
});

describe('inferJobType', () => {
  test('ignores a previously stored remote label when the listing is on-site', () => {
    assert.equal(inferJobType({
      job_type: 'remote',
      title: 'Accountant',
      location: 'Nairobi, Kenya',
      description: 'Office-based accounting role in Westlands.',
    }), 'onsite');
  });

  test('keeps remote when the title still says so', () => {
    assert.equal(inferJobType({
      job_type: 'remote',
      title: 'Developer (Remote)',
      location: 'Nairobi, Kenya',
    }), 'remote');
  });

  test('stored Remote placeholder is ignored when reclassifying office jobs', () => {
    assert.equal(inferJobType({
      job_type: 'remote',
      title: 'Accountant',
      location: 'Remote',
      county: 'Nairobi',
      description: 'Join our Nairobi office as an accountant.',
    }), 'onsite');
  });
});

describe('preprocessJob location fallback', () => {
  test('empty location + onsite becomes Not specified', () => {
    const result = preprocessJob(sample({ location: '' }));
    assert.equal(result.ok, true);
    assert.equal(result.job.job_type, 'onsite');
    assert.equal(result.job.location, 'Not specified');
  });

  test('physical Nairobi is onsite even when the API says remote', () => {
    const result = preprocessJob(sample({
      location: 'Nairobi, Kenya',
      job_is_remote: true,
    }));
    assert.equal(result.ok, true);
    assert.equal(result.job.job_type, 'onsite');
    assert.equal(result.job.location, 'Nairobi, Kenya');
  });
});
