const { extractFirstJsonObject } = require('../src/services/llmClient');

describe('extractFirstJsonObject', () => {
  test('takes the first object and ignores trailing junk', () => {
    const raw = '{"resume":{"basics":{"name":"E"}},"changes_summary":["x"]} trailing {not}';
    const slice = extractFirstJsonObject(raw);
    expect(JSON.parse(slice).resume.basics.name).toBe('E');
  });

  test('strips markdown fences', () => {
    const raw = '```json\n{"a":1}\n```\nnote';
    expect(JSON.parse(extractFirstJsonObject(raw))).toEqual({ a: 1 });
  });

  test('respects braces inside strings', () => {
    const raw = '{"t":"say } please"} extra';
    expect(JSON.parse(extractFirstJsonObject(raw)).t).toBe('say } please');
  });
});
