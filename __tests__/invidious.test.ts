/* eslint-env jest */
/**
 * Invidious fallback path: failover across instances, WebVTT parsing (multi-line cues,
 * HH:MM:SS vs MM:SS), and the SSRF caption-URL guard. These exercise src/api.ts ranges
 * (initInvidiousClient, tryWithInvidiousInstances, fetchTranscriptViaInvidious, parseWebVTT,
 * timeToSeconds, resolveInvidiousCaptionPath) that the YouTube-path tests never reach.
 *
 * The mock routes on the axios client's current `defaults.baseURL`, which
 * `tryWithInvidiousInstances` rewrites before each instance attempt — that is how a
 * "first instance fails, second succeeds" scenario is simulated deterministically.
 */
import { YouTubeTranscriptApi, TranscriptsDisabled } from '../src';

jest.mock('axios');

const INSTANCE_A = 'https://invidious-a.example';
const INSTANCE_B = 'https://invidious-b.example';

// A YouTube watch page with NO captions, used to make the YouTube *fallback* deterministic
// when an Invidious attempt fails (Invidious is a fallback layer: its failures degrade to YouTube).
const YT_NO_CAPTIONS_HTML = `<!DOCTYPE html><html><body><script>var ytInitialPlayerResponse = ${JSON.stringify(
  {
    playabilityStatus: { status: 'OK' },
    videoDetails: { videoId: 'dQw4w9WgXcQ', title: 'x', lengthSeconds: '1', author: 'y' },
  },
)};</script></body></html>`;

// Multi-line cue + both timestamp shapes (HH:MM:SS.mmm and MM:SS.mmm).
const VTT_BODY = [
  'WEBVTT',
  '',
  '00:00:00.000 --> 00:00:02.500',
  'Never gonna give you up',
  '',
  '00:00:02.500 --> 00:00:05.000',
  'line one',
  'line two',
  '',
  '01:00:00.000 --> 01:00:03.000',
  'One hour in',
  '',
].join('\n');

interface AxiosLikeError extends Error {
  isAxiosError: boolean;
  response?: { status: number };
}

function axiosError(status: number): AxiosLikeError {
  const err = new Error(`Request failed with status code ${status}`) as AxiosLikeError;
  err.isAxiosError = true;
  err.response = { status };
  return err;
}

/**
 * Build an axios mock whose `create()` returns a client whose `get` routes on the
 * client's own `defaults.baseURL`. `failingInstances` is the set of instance origins
 * that should reject (simulating a down instance); any other instance serves real data.
 */
function installInvidiousMock(options: {
  failingInstances?: Set<string>;
  captionUrl?: string;
  captions?: Array<{ languageCode: string; label?: string; url: string }>;
}): { calls: string[] } {
  const failing = options.failingInstances ?? new Set<string>();
  const calls: string[] = [];
  const captionUrl = options.captionUrl ?? '/api/v1/captions/dQw4w9WgXcQ?label=English';
  const captions = options.captions ?? [{ languageCode: 'en', label: 'English', url: captionUrl }];

  const client: {
    defaults: { baseURL: string; headers: { common: Record<string, string> } };
    get: (url: string) => Promise<{ status: number; data: unknown }>;
  } = {
    defaults: { baseURL: INSTANCE_A, headers: { common: {} } },
    get(url: string) {
      const base = this.defaults.baseURL;
      calls.push(`${base}${url}`);

      // YouTube fallback fetch (absolute URL); serve a no-captions page so the fallback
      // resolves deterministically to TranscriptsDisabled.
      if (url === 'https://www.youtube.com/watch') {
        return Promise.resolve({ status: 200, data: YT_NO_CAPTIONS_HTML });
      }

      if (failing.has(base)) {
        return Promise.reject(axiosError(503));
      }
      if (url === '/api/v1/stats') {
        return Promise.resolve({ status: 200, data: { software: { name: 'invidious' } } });
      }
      if (url.startsWith('/api/v1/videos/')) {
        return Promise.resolve({
          status: 200,
          data: {
            videoId: 'dQw4w9WgXcQ',
            title: 'Rick Astley - Never Gonna Give You Up',
            author: 'Rick Astley',
            lengthSeconds: 213,
            viewCount: 1234567890,
          },
        });
      }
      if (url.startsWith('/api/v1/captions/dQw4w9WgXcQ') && !url.includes('label=')) {
        return Promise.resolve({ status: 200, data: { captions } });
      }
      // The caption body fetch (resolveInvidiousCaptionPath returns path+query).
      if (url.includes('/api/v1/captions/')) {
        return Promise.resolve({ status: 200, data: VTT_BODY });
      }
      return Promise.reject(new Error(`Unexpected Invidious URL: ${base}${url}`));
    },
  };

  const axios = require('axios');
  axios.default.create = jest.fn().mockReturnValue(client);
  const isAxiosError = (p: unknown): boolean => (p as AxiosLikeError)?.isAxiosError === true;
  axios.isAxiosError = isAxiosError;
  axios.default.isAxiosError = isAxiosError;

  return { calls };
}

describe('Invidious fallback', () => {
  let consoleErr: jest.SpyInstance;
  let consoleLog: jest.SpyInstance;

  beforeEach(() => {
    consoleErr = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErr.mockRestore();
    consoleLog.mockRestore();
    jest.clearAllMocks();
  });

  it('parses a WebVTT transcript (multi-line cues + HH:MM:SS and MM:SS timestamps)', async () => {
    installInvidiousMock({});
    const api = new YouTubeTranscriptApi({
      invidious: { enabled: true, instanceUrls: INSTANCE_A },
    });

    const result = await api.fetchTranscript('dQw4w9WgXcQ', { languages: ['en'] });

    // Three cues; the middle one collected two text lines into a single snippet.
    expect(result.transcript.snippets).toHaveLength(3);
    expect(result.transcript.snippets[0].text).toBe('Never gonna give you up');
    expect(result.transcript.snippets[0].start).toBe(0);
    expect(result.transcript.snippets[0].duration).toBeCloseTo(2.5, 3);

    // Multi-line cue joined with a newline.
    expect(result.transcript.snippets[1].text).toBe('line one\nline two');

    // HH:MM:SS.mmm parsed as hours (01:00:00 -> 3600s), proving timeToSeconds handles
    // both the 3-part and 2-part timestamp forms.
    expect(result.transcript.snippets[2].start).toBe(3600);

    // Metadata flows from the Invidious /videos response.
    expect(result.metadata.id).toBe('dQw4w9WgXcQ');
    expect(result.metadata.lengthSeconds).toBe(213);
    expect(result.metadata.author).toBe('Rick Astley');
  });

  it('fails over: first instance errors, second instance succeeds', async () => {
    const { calls } = installInvidiousMock({
      failingInstances: new Set([INSTANCE_A]),
    });
    const api = new YouTubeTranscriptApi({
      invidious: { enabled: true, instanceUrls: [INSTANCE_A, INSTANCE_B] },
    });

    const result = await api.fetchTranscript('dQw4w9WgXcQ', { languages: ['en'] });

    // It still resolves, served by instance B.
    expect(result.transcript.snippets.length).toBeGreaterThan(0);
    // Instance A was attempted (and failed) before instance B was tried.
    expect(calls.some(c => c.startsWith(INSTANCE_A))).toBe(true);
    expect(calls.some(c => c.startsWith(INSTANCE_B))).toBe(true);
  });

  it('selects the requested language and serves a Spanish-only instance for es', async () => {
    // Direct success path: the Invidious caption list contains the requested language,
    // so it is selected and parsed without falling back to YouTube.
    installInvidiousMock({
      captions: [
        { languageCode: 'es', label: 'Spanish', url: '/api/v1/captions/dQw4w9WgXcQ?label=Spanish' },
      ],
    });
    const api = new YouTubeTranscriptApi({
      invidious: { enabled: true, instanceUrls: INSTANCE_A },
    });

    const result = await api.fetchTranscript('dQw4w9WgXcQ', { languages: ['es'] });
    expect(result.transcript.languageCode).toBe('es');
    expect(result.transcript.snippets.length).toBeGreaterThan(0);
  });

  it('degrades to the YouTube fallback when the Invidious language is missing', async () => {
    // Requested 'en' but the instance only has 'es' -> Invidious attempt fails, and the
    // library falls back to YouTube (which here has no captions -> TranscriptsDisabled).
    installInvidiousMock({
      captions: [
        { languageCode: 'es', label: 'Spanish', url: '/api/v1/captions/dQw4w9WgXcQ?label=Spanish' },
      ],
    });
    const api = new YouTubeTranscriptApi({
      invidious: { enabled: true, instanceUrls: INSTANCE_A },
    });

    await expect(api.fetchTranscript('dQw4w9WgXcQ', { languages: ['en'] })).rejects.toBeInstanceOf(
      TranscriptsDisabled,
    );
  });

  it('refuses a cross-origin (SSRF) caption URL, then degrades to the YouTube fallback', async () => {
    // Absolute caption URL pointing at cloud-metadata; resolveInvidiousCaptionPath must refuse it.
    // The Invidious attempt therefore fails and the library falls back to YouTube.
    installInvidiousMock({
      captions: [
        { languageCode: 'en', label: 'English', url: 'http://169.254.169.254/latest/meta-data/' },
      ],
    });
    const api = new YouTubeTranscriptApi({
      invidious: { enabled: true, instanceUrls: INSTANCE_A },
    });

    await expect(api.fetchTranscript('dQw4w9WgXcQ', { languages: ['en'] })).rejects.toBeInstanceOf(
      TranscriptsDisabled,
    );
  });

  it('throws when Invidious is enabled without any instance URL', () => {
    expect(
      () => new YouTubeTranscriptApi({ invidious: { enabled: true, instanceUrls: '' } }),
    ).toThrow();
  });

  it('PATCH-1: Invidious-first second identical fetch issues ZERO additional network calls', async () => {
    // Invidious-first is enabled. The first fetch populates the transcript+metadata cache;
    // the second identical fetch must be served entirely from cache (tryCacheHit runs BEFORE
    // the Invidious-first branch), so the mock records no new network calls.
    const { calls } = installInvidiousMock({});
    const api = new YouTubeTranscriptApi({
      invidious: { enabled: true, instanceUrls: INSTANCE_A },
    });

    const first = await api.fetchTranscript('dQw4w9WgXcQ', { languages: ['en'] });
    expect(first.transcript.snippets.length).toBeGreaterThan(0);

    const callsAfterFirst = calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0); // the first fetch DID hit the network

    const second = await api.fetchTranscript('dQw4w9WgXcQ', { languages: ['en'] });
    expect(second.transcript.snippets.length).toBeGreaterThan(0);

    // The crux of PATCH-1: the repeat call added no network calls.
    expect(calls).toHaveLength(callsAfterFirst);
  });
});
