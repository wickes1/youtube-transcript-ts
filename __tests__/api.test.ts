/* eslint-env jest */
import {
  YouTubeTranscriptApi,
  VideoUnavailable,
  IpBlocked,
  TranscriptsDisabled,
  NoTranscriptFound,
  RequestFailed,
  TranscriptList,
  TranscriptEntry,
} from '../src';
import { createTestEnvironment, cleanupMocks } from './utils/mocks';

jest.mock('axios');

describe('YouTubeTranscriptApi', () => {
  // Setup and teardown for each test
  beforeEach(() => {
    createTestEnvironment();
  });

  afterEach(() => {
    cleanupMocks();
  });

  describe('utils', () => {
    it('should extract video ID from YouTube URL', () => {
      expect(YouTubeTranscriptApi.getVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
        'dQw4w9WgXcQ',
      );
      expect(YouTubeTranscriptApi.getVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(YouTubeTranscriptApi.getVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });
  });

  describe('fetchTranscript (happy path)', () => {
    it('should fetch, parse, and return a transcript with metadata', async () => {
      const api = new YouTubeTranscriptApi();
      const result = await api.fetchTranscript('dQw4w9WgXcQ', { languages: ['en'] });

      expect(result.transcript.languageCode).toBe('en');
      expect(result.transcript.snippets.length).toBeGreaterThan(0);
      expect(result.transcript.snippets[0].text).toBe('Never gonna give you up');
      expect(result.transcript.snippets[0].start).toBe(0);

      // Metadata extracted via the brace-depth scanner (description contains `};`).
      expect(result.metadata.id).toBe('dQw4w9WgXcQ');
      expect(result.metadata.lengthSeconds).toBe(213);
      expect(result.metadata.viewCount).toBe(1234567890);
    });

    it('should apply a formatter when requested', async () => {
      const api = new YouTubeTranscriptApi();
      const result = await api.fetchTranscript('dQw4w9WgXcQ', {
        languages: ['en'],
        formatter: 'text',
      });

      expect(typeof result.formattedText).toBe('string');
      expect(result.formattedText).toContain('Never gonna give you up');
    });

    it('should keep the positional (deprecated) call form working', async () => {
      const api = new YouTubeTranscriptApi();
      const result = await api.fetchTranscript('dQw4w9WgXcQ', ['en']);
      expect(result.transcript.languageCode).toBe('en');
    });
  });

  describe('error handling', () => {
    it('should throw VideoUnavailable for a deleted video (404)', async () => {
      const api = new YouTubeTranscriptApi();
      await expect(api.fetchTranscript('unavailable')).rejects.toBeInstanceOf(VideoUnavailable);
    });

    it('should throw TranscriptsDisabled when the page has no captions', async () => {
      const api = new YouTubeTranscriptApi();
      await expect(api.fetchTranscript('no-transcripts')).rejects.toBeInstanceOf(
        TranscriptsDisabled,
      );
    });

    it('should throw IpBlocked on a 403 response', async () => {
      const api = new YouTubeTranscriptApi();
      await expect(api.fetchTranscript('ip-blocked')).rejects.toBeInstanceOf(IpBlocked);
    });

    it('PATCH-2: maps a 429 watch fetch to retryable RequestFailed (not IpBlocked)', async () => {
      const api = new YouTubeTranscriptApi();
      const err = (await api
        .fetchTranscript('rate-limited')
        .catch((e: unknown) => e)) as RequestFailed;
      expect(err).toBeInstanceOf(RequestFailed);
      expect(err).not.toBeInstanceOf(IpBlocked);
      expect(err.retryable).toBe(true);
    });

    it('should throw NoTranscriptFound when the requested language is not available', async () => {
      // The valid mock exposes only `en`/`es` caption tracks; `fr` exists solely as a
      // translation language, so findTranscript() raises NoTranscriptFound before any
      // content fetch. Invidious is disabled, so the error surfaces unchanged.
      const api = new YouTubeTranscriptApi();
      await expect(
        api.fetchTranscript('dQw4w9WgXcQ', { languages: ['fr'] }),
      ).rejects.toBeInstanceOf(NoTranscriptFound);
    });
  });

  describe('listTranscripts', () => {
    it('returns a TranscriptList whose entry fetches a parsed Transcript', async () => {
      const api = new YouTubeTranscriptApi();
      const list = await api.listTranscripts('dQw4w9WgXcQ');
      expect(list).toBeInstanceOf(TranscriptList);

      const entry = await list.findTranscript(['en']);
      expect(entry).toBeInstanceOf(TranscriptEntry);

      const transcript = await entry.fetch();
      expect(transcript.languageCode).toBe('en');
      expect(transcript.snippets[0].text).toBe('Never gonna give you up');
      expect(transcript.snippets[0].start).toBe(0);
    });

    it('raises NoTranscriptFound from findTranscript for an absent language', async () => {
      const api = new YouTubeTranscriptApi();
      const list = await api.listTranscripts('dQw4w9WgXcQ');
      await expect(list.findTranscript(['fr'])).rejects.toBeInstanceOf(NoTranscriptFound);
    });
  });

  describe('api configuration', () => {
    it('should set cookies on the underlying http client', () => {
      const api = new YouTubeTranscriptApi();
      api.setCookies({ CONSENT: 'YES', TEST: 'VALUE' });
      const cookie = (api as any).httpClient.defaults.headers.common['Cookie'];
      expect(cookie).toBe('CONSENT=YES; TEST=VALUE');
    });

    it('should clear the transcript cache', () => {
      const api = new YouTubeTranscriptApi();
      const internal = api as any;
      internal.cache.transcript.set('k', { data: {}, timestamp: Date.now() });
      expect(internal.cache.transcript.size).toBe(1);
      api.clearCache('transcript');
      expect(internal.cache.transcript.size).toBe(0);
    });

    it('should disable caching when configured', () => {
      const api = new YouTubeTranscriptApi();
      api.setCacheOptions({ enabled: false });
      expect((api as any).cacheOptions.enabled).toBe(false);
    });

    it('should update logger options', () => {
      const api = new YouTubeTranscriptApi();
      api.setLoggerOptions({ enabled: true, namespace: 'test' });
      expect((api as any).loggerOptions.namespace).toBe('test');
    });

    it('should invoke a custom logger callback during a fetch', async () => {
      const logger = jest.fn().mockReturnValue(true); // return true: suppress default console.log
      const api = new YouTubeTranscriptApi({ logger: { enabled: true, logger } });

      await api.fetchTranscript('dQw4w9WgXcQ', { languages: ['en'] });

      // The fetch path emits performance/info logs; the custom callback must have run.
      expect(logger).toHaveBeenCalled();
      const [type, message] = logger.mock.calls[0];
      expect(typeof type).toBe('string');
      expect(typeof message).toBe('string');
    });

    it('should not invoke the logger callback when logging is disabled', async () => {
      const logger = jest.fn().mockReturnValue(true);
      const api = new YouTubeTranscriptApi({ logger: { enabled: false, logger } });

      await api.fetchTranscript('dQw4w9WgXcQ', { languages: ['en'] });
      expect(logger).not.toHaveBeenCalled();
    });

    it('should evict the oldest entry once the cache exceeds maxSize', () => {
      const api = new YouTubeTranscriptApi({ cache: { maxSize: 2 } });
      const internal = api as any;

      internal.cacheSet(internal.cache.transcript, 'a', { snippets: [] });
      internal.cacheSet(internal.cache.transcript, 'b', { snippets: [] });
      internal.cacheSet(internal.cache.transcript, 'c', { snippets: [] }); // evicts 'a'

      expect(internal.cache.transcript.size).toBe(2);
      expect(internal.cache.transcript.has('a')).toBe(false);
      expect(internal.cache.transcript.has('c')).toBe(true);
    });

    it('clearCache("transcript") also clears the parallel metadata cache', () => {
      const api = new YouTubeTranscriptApi();
      const internal = api as any;
      internal.cache.transcript.set('k', { data: {}, timestamp: Date.now() });
      internal.cache.metadata.set('k', { data: {}, timestamp: Date.now() });

      api.clearCache('transcript');

      expect(internal.cache.transcript.size).toBe(0);
      expect(internal.cache.metadata.size).toBe(0);
    });

    it('preserves a previously-set Cookie across a proxy change', () => {
      const api = new YouTubeTranscriptApi();
      api.setCookies({ CONSENT: 'YES' });

      // Changing proxy config rebuilds the http client; the Cookie must survive.
      api.setProxyOptions({ enabled: true, http: 'http://proxy.example:8080' });

      const cookie = (api as any).httpClient.defaults.headers.common['Cookie'];
      expect(cookie).toBe('CONSENT=YES');
    });
  });
});
