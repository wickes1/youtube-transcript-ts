/* eslint-env jest */
/**
 * Post-review hardening patches (v2.0.0):
 *   - RequestFailed.cause is a real, type-resolvable member (PATCH-5).
 *   - isBlockedHost handles bracketed IPv6 literals and no longer over-blocks
 *     DNS names that merely start with fc/fd/fe80 (PATCH-6).
 *   - TranscriptEntry.fetch: 429 + transport errors -> retryable RequestFailed,
 *     empty/garbage payload -> NoTranscriptFound, fully-escaped XML recovered (PATCH-2 / PATCH-3).
 */
import {
  YouTubeTranscriptApi,
  TranscriptEntry,
  RequestFailed,
  NoTranscriptFound,
  VideoUnavailable,
  type TranslationLanguage,
} from '../src';
import type { AxiosInstance } from 'axios';

jest.mock('axios');

interface AxiosLikeError extends Error {
  isAxiosError: boolean;
  code?: string;
  response?: { status: number };
}

function axiosError(opts: { status?: number; code?: string }): AxiosLikeError {
  const err = new Error('boom') as AxiosLikeError;
  err.isAxiosError = true;
  if (opts.status !== undefined) err.response = { status: opts.status };
  if (opts.code !== undefined) err.code = opts.code;
  return err;
}

beforeAll(() => {
  // Wire axios.isAxiosError so TranscriptEntry.fetch()'s error-mapping branch is reachable.
  const axios = require('axios');
  const isAxiosError = (p: unknown): boolean => (p as AxiosLikeError)?.isAxiosError === true;
  axios.isAxiosError = isAxiosError;
  axios.default.isAxiosError = isAxiosError;
});

/** Build a stub AxiosInstance whose get() resolves/rejects per the provided implementation. */
function stubClient(get: jest.Mock): AxiosInstance {
  return { get } as unknown as AxiosInstance;
}

function makeEntry(client: AxiosInstance, translationLanguages: TranslationLanguage[] = []) {
  return new TranscriptEntry(
    client,
    'vid123',
    'https://www.youtube.com/api/timedtext?lang=en&v=vid123',
    'English',
    'en',
    false,
    translationLanguages,
  );
}

describe('PATCH-5: RequestFailed.cause is a real member', () => {
  it('exposes the root error on .cause without a cast', () => {
    const root = new Error('socket hang up');
    const e = new RequestFailed('v', 'r', { cause: root });
    expect(e.cause).toBe(root);
    expect(e.retryable).toBe(true);
  });

  it('leaves cause undefined when no options are provided', () => {
    const e = new RequestFailed('v', 'r');
    expect(e.cause).toBeUndefined();
  });
});

describe('PATCH-6: isBlockedHost IPv6 correctness', () => {
  // isBlockedHost is a private static; reach it directly for a focused unit test.
  const isBlockedHost = (host: string): boolean =>
    (YouTubeTranscriptApi as unknown as { isBlockedHost(h: string): boolean }).isBlockedHost(host);

  it('blocks a bracketed IPv6 ULA literal [fc00::1]', () => {
    expect(isBlockedHost('[fc00::1]')).toBe(true);
  });

  it('blocks a bracketed IPv6 loopback [::1]', () => {
    expect(isBlockedHost('[::1]')).toBe(true);
  });

  it('blocks an unbracketed link-local fe80:: literal', () => {
    expect(isBlockedHost('fe80::1')).toBe(true);
  });

  it('does NOT over-block a DNS host that merely starts with fc/fd/fe80', () => {
    // The original prefix check blocked these as if they were IPv6 literals.
    expect(isBlockedHost('fdroid.example.com')).toBe(false);
    expect(isBlockedHost('fcbarcelona.example')).toBe(false);
    expect(isBlockedHost('fe80.example.com')).toBe(false);
  });

  it('still blocks the IPv4 cloud-metadata and private ranges', () => {
    expect(isBlockedHost('169.254.169.254')).toBe(true);
    expect(isBlockedHost('127.0.0.1')).toBe(true);
    expect(isBlockedHost('10.0.0.5')).toBe(true);
    expect(isBlockedHost('localhost')).toBe(true);
  });

  it('allows an ordinary public host', () => {
    expect(isBlockedHost('www.youtube.com')).toBe(false);
  });
});

describe('PATCH-2: TranscriptEntry.fetch retry classification', () => {
  it('maps a 429 (throttling) content fetch to retryable RequestFailed (not IpBlocked)', async () => {
    const entry = makeEntry(stubClient(jest.fn().mockRejectedValue(axiosError({ status: 429 }))));
    const err = (await entry.fetch().catch((e: unknown) => e)) as RequestFailed;
    expect(err).toBeInstanceOf(RequestFailed);
    expect(err.retryable).toBe(true);
  });

  it('maps a transport error with no response (ECONNRESET) to retryable RequestFailed', async () => {
    const entry = makeEntry(
      stubClient(jest.fn().mockRejectedValue(axiosError({ code: 'ECONNRESET' }))),
    );
    const err = (await entry.fetch().catch((e: unknown) => e)) as RequestFailed;
    expect(err).toBeInstanceOf(RequestFailed);
    expect(err.retryable).toBe(true);
    // The originating error is preserved for consumer backoff logic.
    expect((err.cause as AxiosLikeError)?.code).toBe('ECONNRESET');
  });

  it('maps EAI_AGAIN (DNS, no response) to retryable RequestFailed', async () => {
    const entry = makeEntry(
      stubClient(jest.fn().mockRejectedValue(axiosError({ code: 'EAI_AGAIN' }))),
    );
    await expect(entry.fetch()).rejects.toBeInstanceOf(RequestFailed);
  });
});

describe('PATCH-3: empty-transcript guard + escaped-XML recovery', () => {
  it('throws NoTranscriptFound when the payload yields zero snippets (garbage body)', async () => {
    const entry = makeEntry(
      stubClient(
        jest.fn().mockResolvedValue({ status: 200, data: '<html>not a transcript</html>' }),
      ),
    );
    await expect(entry.fetch()).rejects.toBeInstanceOf(NoTranscriptFound);
  });

  it('throws NoTranscriptFound for an empty body', async () => {
    const entry = makeEntry(stubClient(jest.fn().mockResolvedValue({ status: 200, data: '' })));
    await expect(entry.fetch()).rejects.toBeInstanceOf(NoTranscriptFound);
  });

  it('throws NoTranscriptFound when <text> attributes are reordered (no raw match, no escaped match)', async () => {
    // dur before start: the strict matcher does not match, and there is nothing to
    // recover by decoding, so this must surface as NoTranscriptFound (not a silent empty).
    const reordered =
      '<?xml version="1.0"?><transcript><text dur="2.5" start="0">Hello</text></transcript>';
    const entry = makeEntry(
      stubClient(jest.fn().mockResolvedValue({ status: 200, data: reordered })),
    );
    await expect(entry.fetch()).rejects.toBeInstanceOf(NoTranscriptFound);
  });

  it('recovers a fully-escaped XML payload via the whole-document decode fallback', async () => {
    // An instance that double-escapes the transcript: the raw body has zero `<text>`
    // matches, so parseTranscript decodes the whole document once and retries.
    const escaped =
      '&lt;transcript&gt;&lt;text start="0" dur="2.5"&gt;Never gonna give you up&lt;/text&gt;' +
      '&lt;text start="2.5" dur="3"&gt;Never gonna let you down&lt;/text&gt;&lt;/transcript&gt;';
    const entry = makeEntry(
      stubClient(jest.fn().mockResolvedValue({ status: 200, data: escaped })),
    );

    const transcript = await entry.fetch();
    expect(transcript.snippets).toHaveLength(2);
    expect(transcript.snippets[0].text).toBe('Never gonna give you up');
    expect(transcript.snippets[0].start).toBe(0);
    expect(transcript.snippets[0].duration).toBeCloseTo(2.5, 3);
    expect(transcript.snippets[1].text).toBe('Never gonna let you down');
  });

  it('does not double-process a normal (raw) XML payload through the fallback', async () => {
    // Sanity: the primary raw path still works and is not disturbed by the new fallback.
    const raw =
      '<?xml version="1.0"?><transcript><text start="0" dur="2.5">Hello &amp; welcome</text></transcript>';
    const entry = makeEntry(stubClient(jest.fn().mockResolvedValue({ status: 200, data: raw })));
    const transcript = await entry.fetch();
    expect(transcript.snippets).toHaveLength(1);
    expect(transcript.snippets[0].text).toBe('Hello & welcome');
  });

  it('still surfaces a 404 content fetch as VideoUnavailable (unchanged)', async () => {
    const entry = makeEntry(stubClient(jest.fn().mockRejectedValue(axiosError({ status: 404 }))));
    await expect(entry.fetch()).rejects.toBeInstanceOf(VideoUnavailable);
  });
});
