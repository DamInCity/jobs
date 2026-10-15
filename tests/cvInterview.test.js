const { compactResume } = require('../src/services/cvInterview');

describe('cvInterview compactResume', () => {
  test('drops extra fields and keeps work highlights', () => {
    const out = compactResume({
      basics: { name: 'Elias', email: 'x@y.z', summary: 'Linux admin' },
      work: [{ name: 'Acme', position: 'IT', highlights: ['Linux servers'] }],
      skills: [{ name: 'Linux', keywords: ['Ubuntu'] }],
      junk: true,
    });
    expect(out.basics.name).toBe('Elias');
    expect(out.work[0].highlights[0]).toBe('Linux servers');
    expect(out.junk).toBeUndefined();
  });
});
