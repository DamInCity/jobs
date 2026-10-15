const {
  extractJdTerms,
  selectSkills,
  scoreTailored,
  lockSkills,
  clusterOf,
  MAX_SKILLS,
} = require('../src/services/atsPipeline');

const master = {
  basics: {
    summary: 'Linux and network support professional with Python automation.',
  },
  work: [
    {
      name: 'Acme',
      position: 'IT Support',
      highlights: [
        'Administered Linux servers and user access',
        'Configured Cisco routing for branch offices',
        'Wrote Bash and Python scripts to automate backups',
        'Maintained the company website and SEO pages',
      ],
    },
  ],
  skills: [
    { name: 'Operating Systems', keywords: ['Linux fundamentals', 'troubleshooting'] },
    { name: 'System Administration', keywords: ['Linux system administration', 'server management'] },
    { name: 'Networking', keywords: ['Cisco routing and switching'] },
    { name: 'Network Administration', keywords: ['Network administration', 'network support'] },
    { name: 'Scripting & Tools', keywords: ['Python', 'JavaScript', 'Bash'] },
    { name: 'Automation', keywords: ['Bash scripting', 'Python scripting'] },
    { name: 'Web & Platforms', keywords: ['Website management', 'SEO'] },
    { name: 'Web Development', keywords: ['Website deployment'] },
    { name: 'Digital Marketing', keywords: ['Campaign management'] },
    { name: 'Photography & Media', keywords: ['Photography'] },
    { name: 'Stakeholder Communication', keywords: ['Stakeholder management'] },
  ],
};

describe('atsPipeline', () => {
  test('extractJdTerms marks title words as tier 1', () => {
    const jd = extractJdTerms({
      title: 'Linux System Administrator',
      description: 'Required: Linux, Cisco, Python. Nice to have photography.',
    });
    const t1 = jd.tier1.map((t) => t.term).join(' ');
    expect(t1).toMatch(/linux/);
  });

  test('selectSkills collapses linux/network/script clusters and stays ≤15', () => {
    const { skills } = selectSkills(master, {
      title: 'Linux Network Administrator',
      description:
        'We require Linux system administration, Cisco networking, and Python automation. Website SEO is a plus.',
    });
    expect(skills.length).toBeGreaterThanOrEqual(1);
    expect(skills.length).toBeLessThanOrEqual(MAX_SKILLS);
    const clusters = skills.map((s) => clusterOf(s.name)).filter(Boolean);
    expect(new Set(clusters).size).toBe(clusters.length);
  });

  test('lockSkills overwrites model fluff', () => {
    const selection = selectSkills(master, {
      title: 'Linux Administrator',
      description: 'Required Linux and Python.',
    });
    const locked = lockSkills(
      { skills: [{ name: 'Everything', keywords: ['a', 'b', 'c'] }, { name: 'More' }] },
      selection
    );
    expect(locked.skills.length).toBe(selection.skills.length);
    expect(locked.skills.every((s) => !s.keywords?.length)).toBe(true);
  });

  test('scoreTailored caption format', () => {
    const sel = selectSkills(master, {
      title: 'Linux Administrator',
      description: 'Required Linux Python Cisco',
    });
    const resume = lockSkills({ basics: { summary: 'Linux Python Cisco' }, work: [] }, sel);
    const score = scoreTailored(resume, { title: 'Linux Administrator', description: 'Linux Python Cisco' }, sel);
    expect(score.caption).toMatch(/^Match \d+\/\d+ · \d+ skills$/);
    expect(score.skill_count).toBeLessThanOrEqual(MAX_SKILLS);
  });
});
