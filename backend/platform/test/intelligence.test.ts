import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IntelligenceClient, validateExtraction } from '../src/intelligence/client.js';

const result = {
  schemaVersion: 1, parser: { name: 'pypdf', version: '6.19.0' }, status: 'extracted', pageCount: 2,
  pages: [{ number: 1, text: 'Engineer Ω' }, { number: 2, text: 'Python' }], text: 'Engineer Ω\n\nPython', warnings: [],
};
const settings = { url: 'http://parser.test', token: 'ab'.repeat(32) };
const isCode = (code: string) => (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === code;

test('extractor validates page boundaries, Unicode, warnings, limits and unknown fields', () => {
  assert.deepEqual(validateExtraction(result), result);
  const empty = { ...result, pageCount: 1, status: 'no_text', pages: [{ number: 1, text: '' }], text: '', warnings: [{ code: 'NO_EXTRACTABLE_TEXT', message: 'No readable text.' }] };
  assert.deepEqual(validateExtraction(empty), empty);
  for (const changed of [
    { ...result, ownerId: 'untrusted' }, { ...result, schemaVersion: 2 }, { ...result, pageCount: 51 },
    { ...result, pageCount: 1 }, { ...result, status: 'no_text' }, { ...result, text: 'different text' },
    { ...result, parser: { name: 'unknown', version: '1.0.0' } },
    { ...empty, warnings: [] }, { ...empty, text: 'x'.repeat(200_001) },
    { ...result, pages: [{ number: 2, text: 'Engineer Ω' }, { number: 1, text: 'Python' }] },
  ]) assert.throws(() => validateExtraction(changed), isCode('INTELLIGENCE_RESPONSE_INVALID'));
});

test('optional invalid/disabled intelligence leaves feature status unavailable', async () => {
  for (const config of [{}, { url: 'https://example.com' }, { ...settings, url: 'https://example.com/other' }, { ...settings, url: 'file:///tmp/private' }]) {
    const client = new IntelligenceClient(config, async () => { throw new Error('must not fetch'); });
    assert.equal((await client.status()).resumeExtraction.available, false);
    await assert.rejects(client.extract(Buffer.from('%PDF-'), 'request', new AbortController().signal), isCode('INTELLIGENCE_UNAVAILABLE'));
  }
});

test('structural repair warnings are optional, safe and compatible with empty-page warnings', () => {
  const repair = { code: 'PDF_STRUCTURE_REPAIRED', message: 'Minor PDF structure issues were corrected during extraction. Review the text against your original PDF.' };
  const empty = { ...result, pageCount: 1, status: 'no_text', pages: [{ number: 1, text: '' }], text: '', warnings: [{ code: 'NO_EXTRACTABLE_TEXT', message: 'No readable text.' }, repair] };
  const partial = { ...result, pages: [{ number: 1, text: 'Engineer Ω' }, { number: 2, text: '' }], text: 'Engineer Ω\n\n', warnings: [{ code: 'PAGES_WITHOUT_TEXT', message: 'Some pages have no text.' }, repair] };
  for (const value of [{ ...result, warnings: [repair] }, empty, partial]) assert.deepEqual(validateExtraction(value), value);
  for (const warnings of [[repair, repair], [{ ...repair, message: 'raw document details' }], [{ ...repair, code: 'UNKNOWN_WARNING' }], [{ ...repair, raw: 'private' }]]) {
    assert.throws(() => validateExtraction({ ...result, warnings }), isCode('INTELLIGENCE_RESPONSE_INVALID'));
  }
  for (const value of [empty, partial]) {
    assert.throws(() => validateExtraction({ ...value, warnings: [repair] }), isCode('INTELLIGENCE_RESPONSE_INVALID'));
  }
});

test('internal authentication failures do not become browser authentication failures', async () => {
  const client = new IntelligenceClient(settings, async () => new Response('private error', { status: 401 }));
  await assert.rejects(client.extract(Buffer.from('%PDF-'), 'request', new AbortController().signal), isCode('INTELLIGENCE_UNAVAILABLE'));
});

test('bounded upstream errors are mapped safely; inconsistent statuses/output are rejected', async () => {
  for (const [status, code] of [[413, 'EXTRACTION_LIMIT'], [422, 'PDF_ENCRYPTED'], [503, 'INTELLIGENCE_BUSY'], [504, 'INTELLIGENCE_TIMEOUT'], [503, 'PARSER_RESOURCE_LIMIT']] as const) {
    const client = new IntelligenceClient(settings, async () => Response.json({ error: { code, message: 'private parser details' } }, { status }));
    await assert.rejects(client.extract(Buffer.from('%PDF-'), 'request', new AbortController().signal), error => {
      assert.ok(isCode(code)(error)); assert.equal((error as Error).message.includes('private parser'), false); return true;
    });
  }
  for (const response of [Response.json({ error: { code: 'PDF_ENCRYPTED', message: '' } }, { status: 500 }),
    new Response('{invalid', { headers: { 'Content-Type': 'application/json' } }),
    Response.json({ ...result, extra: true }),
    new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } })]) {
    const client = new IntelligenceClient(settings, async () => response);
    await assert.rejects(client.extract(Buffer.from('%PDF-'), 'request', new AbortController().signal), isCode('INTELLIGENCE_RESPONSE_INVALID'));
  }
});
