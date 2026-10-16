/* eslint-env jest */
/**
 * Mock utilities for testing - this is not a test file.
 *
 * The success HTML uses YouTube's real key order with `videoDetails` AFTER `captions`
 * and is minified to a single line so the production brace-depth scanner (which no longer
 * relies on a `,"videoDetails"` delimiter) parses it. Axios responses are shaped like real
 * axios results: a `status` field plus `data`, and error cases reject with an axios-shaped
 * error so `axios.isAxiosError` routing is exercised.
 */
import type { AxiosError } from 'axios';

// A player response with captions BEFORE videoDetails (YouTube's real order), and a
// description containing `};` to exercise the brace-depth scanner. `trackQuery` is appended
// to each caption baseUrl so the page copy and the InnerTube copy point at different bodies.
const buildPlayerResponse = (trackQuery: string) => ({
  playabilityStatus: { status: 'OK' },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: `https://www.youtube.com/api/timedtext?lang=en&v=dQw4w9WgXcQ${trackQuery}`,
          name: { simpleText: 'English' },
          languageCode: 'en',
          kind: '',
          isTranslatable: true,
        },
        {
          baseUrl: `https://www.youtube.com/api/timedtext?lang=es&v=dQw4w9WgXcQ${trackQuery}`,
          name: { simpleText: 'Spanish' },
          languageCode: 'es',
          kind: '',
          isTranslatable: true,
        },
      ],
      translationLanguages: [
        { languageCode: 'de', languageName: { simpleText: 'German' } },
        { languageCode: 'fr', languageName: { simpleText: 'French' } },
      ],
    },
  },
  microformat: {
    playerMicroformatRenderer: {
      publishDate: '2009-10-25',
      category: 'Music',
    },
  },
  videoDetails: {
    videoId: 'dQw4w9WgXcQ',
    title: 'Rick Astley - Never Gonna Give You Up (Official Music Video)',
    lengthSeconds: '213',
    author: 'Rick Astley',
    channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    shortDescription: 'Official video. Sample code: const f = () => { return 42; };',
    viewCount: '1234567890',
    isPrivate: false,
    isLiveContent: false,
  },
});

// The watch page's own caption URLs carry `exp=xpe` (PO-token gated, empty body); InnerTube's
// ANDROID URLs work but request srv3, which the library must strip.
const validPlayerResponse = JSON.stringify(buildPlayerResponse('&exp=xpe'));
export const innertubePlayerResponse = buildPlayerResponse('&fmt=srv3');

// A player response with NO captions field (transcripts effectively disabled).
const noCaptionsObject = {
  playabilityStatus: { status: 'OK' },
  videoDetails: {
    videoId: 'no-transcripts',
    title: 'Video without Transcripts',
    lengthSeconds: '120',
    author: 'Test Channel',
    viewCount: '1000',
  },
};
const noCaptionsPlayerResponse = JSON.stringify(noCaptionsObject);

// InnerTube player responses for non-playable videos, keyed by video id.
const unplayablePlayerResponses: Record<string, unknown> = {
  'bot-check': {
    playabilityStatus: { status: 'LOGIN_REQUIRED', reason: "Sign in to confirm you're not a bot" },
  },
  'innertube-unplayable': {
    playabilityStatus: { status: 'UNPLAYABLE', reason: 'Video unavailable' },
  },
};

const INNERTUBE_KEY_SCRIPT = '<script>ytcfg.set({"INNERTUBE_API_KEY":"test-key"});</script>';

// Mock HTML responses for different scenarios
export const mockHtmlResponses = {
  validVideo: `<!DOCTYPE html><html><head><title>Rick Astley</title></head><body>${INNERTUBE_KEY_SCRIPT}<script>var ytInitialPlayerResponse = ${validPlayerResponse};</script></body></html>`,
  noTranscripts: `<!DOCTYPE html><html><head><title>No Transcripts</title></head><body>${INNERTUBE_KEY_SCRIPT}<script>var ytInitialPlayerResponse = ${noCaptionsPlayerResponse};</script></body></html>`,
};

// Mock transcript XML responses (RAW, with escaped entities to exercise group-only decoding).
export const mockTranscriptResponses = {
  // What YouTube serves for `fmt=srv3`: millisecond `<p t d>` cues the parser cannot read.
  srv3: `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="0" d="4500">Never gonna give you up</p></body></timedtext>`,
  english: `<?xml version="1.0" encoding="utf-8" ?><transcript><text start="0" dur="4.5">Never gonna give you up</text><text start="4.5" dur="3.5">Never gonna let you down</text><text start="8" dur="4">Never gonna run around and desert you</text></transcript>`,
  spanish: `<?xml version="1.0" encoding="utf-8" ?><transcript><text start="0" dur="4.5">Espanol! Nunca te voy a abandonar</text><text start="4.5" dur="3.5">Nunca te voy a defraudar</text></transcript>`,
};

/**
 * Build an axios-shaped error (so `axios.isAxiosError` returns true) with the given status.
 */
function makeAxiosError(status: number): AxiosError {
  const error = new Error(`Request failed with status code ${status}`) as AxiosError;
  error.isAxiosError = true;
  error.name = 'AxiosError';
  error.toJSON = () => ({});
  // Minimal axios response shape.
  error.response = {
    status,
    statusText: '',
    data: '',
    headers: {},
    config: {} as any,
  };
  return error;
}

// Mock implementation for axios
export const mockAxios = {
  create: jest.fn().mockReturnValue({
    get: jest.fn().mockImplementation((url: string, config: any) => {
      // Handle watch URL (HTML requests)
      if (url === 'https://www.youtube.com/watch') {
        const videoId = config?.params?.v;

        if (videoId === 'dQw4w9WgXcQ') {
          return Promise.resolve({ status: 200, data: mockHtmlResponses.validVideo });
        }
        if (videoId === 'no-transcripts') {
          return Promise.resolve({ status: 200, data: mockHtmlResponses.noTranscripts });
        }
        if (videoId in unplayablePlayerResponses) {
          return Promise.resolve({ status: 200, data: mockHtmlResponses.validVideo });
        }
        if (videoId === 'unavailable') {
          // A deleted video: YouTube returns 404.
          return Promise.reject(makeAxiosError(404));
        }
        if (videoId === 'ip-blocked') {
          // IP block / geo-restriction: 403.
          return Promise.reject(makeAxiosError(403));
        }
        if (videoId === 'rate-limited') {
          // Throttling: 429 -> must map to retryable RequestFailed, not IpBlocked.
          return Promise.reject(makeAxiosError(429));
        }
      }

      // Handle transcript URL requests
      if (url.includes('api/timedtext')) {
        if (url.includes('exp=xpe')) {
          return Promise.resolve({ status: 200, data: '' });
        }
        if (url.includes('fmt=srv3')) {
          return Promise.resolve({ status: 200, data: mockTranscriptResponses.srv3 });
        }
        if (url.includes('lang=en')) {
          return Promise.resolve({ status: 200, data: mockTranscriptResponses.english });
        }
        if (url.includes('lang=es')) {
          return Promise.resolve({ status: 200, data: mockTranscriptResponses.spanish });
        }
      }

      console.warn(`Unexpected URL in tests: ${url}`, config);
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }),
    post: jest.fn().mockImplementation((url: string, body: any, config: any) => {
      if (
        url === 'https://www.youtube.com/youtubei/v1/player' &&
        config?.params?.key === 'test-key'
      ) {
        const videoId = body?.videoId;
        if (videoId === 'dQw4w9WgXcQ') {
          return Promise.resolve({ status: 200, data: innertubePlayerResponse });
        }
        if (videoId === 'no-transcripts') {
          return Promise.resolve({ status: 200, data: noCaptionsObject });
        }
        if (videoId in unplayablePlayerResponses) {
          return Promise.resolve({ status: 200, data: unplayablePlayerResponses[videoId] });
        }
      }
      return Promise.reject(new Error(`Unexpected POST in tests: ${url}`));
    }),
    defaults: {
      headers: {
        common: {},
      },
    },
  }),
};

/**
 * Create a testing environment with mocked dependencies
 */
export function createTestEnvironment() {
  // Mock console.log
  const originalConsoleLog = console.log;
  const mockConsoleLog = jest.fn();
  console.log = mockConsoleLog;

  // Mock console.error
  const originalConsoleError = console.error;
  const mockConsoleError = jest.fn();
  console.error = mockConsoleError;

  // Setup axios mock
  const axios = require('axios');
  axios.default.create = mockAxios.create;
  // The axios automock stubs isAxiosError to return undefined, which would defeat the
  // library's error-type routing (403 -> IpBlocked, 404 -> VideoUnavailable). Restore a
  // real implementation keyed on the `isAxiosError` marker our mock errors carry.
  const realIsAxiosError = (payload: any): boolean => payload?.isAxiosError === true;
  axios.isAxiosError = realIsAxiosError;
  axios.default.isAxiosError = realIsAxiosError;

  return {
    mockAxios,
    mockConsoleLog,
    mockConsoleError,
    cleanup: () => {
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
    },
  };
}

/**
 * Cleanup mocks after testing
 */
export function cleanupMocks() {
  const { cleanup } = createTestEnvironment();
  cleanup();
}
