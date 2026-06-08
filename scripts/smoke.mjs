// Post-build smoke test: proves the BUILT dist is importable and constructable in
// both ESM and CJS — the exact gate that would have caught the two shipped criticals
// (extensionless ESM re-export -> ERR_MODULE_NOT_FOUND; `require` in an ESM module ->
// `require is not defined`). Exits non-zero with a clear message on any failure.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

function fail(message, error) {
  console.error(`SMOKE FAIL: ${message}`);
  if (error) console.error(error);
  process.exit(1);
}

// --- 1. ESM ----------------------------------------------------------------
let esm;
try {
  esm = await import('../dist/index.js');
} catch (error) {
  fail('ESM import of ../dist/index.js threw (CRITICAL-1 regression?)', error);
}

const { YouTubeTranscriptApi, FormatterFactory, IpBlocked } = esm;

assert.equal(typeof YouTubeTranscriptApi, 'function', 'YouTubeTranscriptApi export missing');
assert.equal(typeof FormatterFactory, 'function', 'FormatterFactory export missing');
assert.equal(typeof IpBlocked, 'function', 'IpBlocked export missing');

// Construction must not throw (CRITICAL-2: `require is not defined` on keep-alive agents).
let api;
try {
  api = new YouTubeTranscriptApi();
} catch (error) {
  fail('new YouTubeTranscriptApi() threw in ESM (CRITICAL-2 regression?)', error);
}

// getVideoId on a real URL.
const id = YouTubeTranscriptApi.getVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
assert.equal(id, 'dQw4w9WgXcQ', `getVideoId returned "${id}"`);

// A formatter formats a hand-built Transcript.
const transcript = {
  snippets: [{ text: 'hello world', start: 0, duration: 1.5 }],
  videoId: 'dQw4w9WgXcQ',
  language: 'English',
  languageCode: 'en',
  isGenerated: false,
};
const formatted = FormatterFactory.create('text').format(transcript);
assert.equal(formatted, 'hello world', `text formatter returned "${formatted}"`);

const json = FormatterFactory.create('json').format(transcript);
assert.equal(JSON.parse(json).videoId, 'dQw4w9WgXcQ', 'json formatter round-trip failed');

// IpBlocked is a usable constructor.
const err = new IpBlocked('dQw4w9WgXcQ');
assert.ok(err instanceof Error, 'IpBlocked instance is not an Error');
assert.equal(err.name, 'IpBlocked', 'IpBlocked.name wrong');

// Silence unused-var lint without dropping the construction assertion.
assert.ok(api, 'api instance missing');

// --- 2. CJS ----------------------------------------------------------------
const require = createRequire(import.meta.url);
let cjs;
try {
  cjs = require('../dist/index.cjs');
} catch (error) {
  fail('CJS require of ../dist/index.cjs threw', error);
}

assert.equal(typeof cjs.YouTubeTranscriptApi, 'function', 'CJS YouTubeTranscriptApi missing');
try {
  const cjsApi = new cjs.YouTubeTranscriptApi();
  assert.ok(cjsApi, 'CJS api instance missing');
} catch (error) {
  fail('new YouTubeTranscriptApi() threw in CJS', error);
}

console.log('SMOKE OK: ESM + CJS import and construct of built dist verified');
