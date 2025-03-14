/* eslint-env jest */
import { YouTubeTranscriptApi } from '../src';
import { createTestEnvironment, cleanupMocks } from './utils/mocks';

jest.mock('axios');

describe('YouTubeTranscriptApi', () => {
  // Setup and teardown for each test
  beforeEach(() => {
    createTestEnvironment();
    jest.useFakeTimers();
  });

  afterEach(() => {
    cleanupMocks();
    jest.useRealTimers();
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

  describe('error handling', () => {
    it('should throw error for unavailable video', async () => {
      const api = new YouTubeTranscriptApi();

      await expect(api.fetchTranscript('unavailable')).rejects.toThrow();
    });

    it('should throw error for video with no transcripts', async () => {
      const api = new YouTubeTranscriptApi();

      await expect(api.fetchTranscript('no-transcripts')).rejects.toThrow();
    });

    it('should throw error for IP blocked', async () => {
      const api = new YouTubeTranscriptApi();

      await expect(api.fetchTranscript('ip-blocked')).rejects.toThrow();
    });
  });

  describe('api configuration', () => {
    it('should allow setting cache options', () => {
      const api = new YouTubeTranscriptApi();
      api.setCacheOptions({ enabled: false });
      // If this doesn't throw, the test passes
      expect(true).toBe(true);
    });

    it('should allow setting logger options', () => {
      const api = new YouTubeTranscriptApi();
      api.setLoggerOptions({ enabled: true, namespace: 'test' });
      // If this doesn't throw, the test passes
      expect(true).toBe(true);
    });

    it('should allow clearing cache', () => {
      const api = new YouTubeTranscriptApi();
      api.clearCache();
      api.clearCache('html');
      api.clearCache('transcript');
      // If this doesn't throw, the test passes
      expect(true).toBe(true);
    });

    it('should allow setting cookies', () => {
      const api = new YouTubeTranscriptApi();
      api.setCookies({ CONSENT: 'YES', TEST: 'VALUE' });
      // If this doesn't throw, the test passes
      expect(true).toBe(true);
    });
  });
});
