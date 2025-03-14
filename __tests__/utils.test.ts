/* eslint-env jest */
import { YouTubeTranscriptApi } from '../src';

describe('Utils', () => {
  describe('getVideoId', () => {
    it('should extract video ID from standard YouTube URL', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      expect(YouTubeTranscriptApi.getVideoId(url)).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from youtu.be short URL', () => {
      const url = 'https://youtu.be/dQw4w9WgXcQ';
      expect(YouTubeTranscriptApi.getVideoId(url)).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from embed URL', () => {
      const url = 'https://www.youtube.com/embed/dQw4w9WgXcQ';
      expect(YouTubeTranscriptApi.getVideoId(url)).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from shorts URL', () => {
      const url = 'https://www.youtube.com/shorts/dQw4w9WgXcQ';
      expect(YouTubeTranscriptApi.getVideoId(url)).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from live URL', () => {
      const url = 'https://www.youtube.com/live/dQw4w9WgXcQ';
      expect(YouTubeTranscriptApi.getVideoId(url)).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from mobile URL', () => {
      const url = 'https://m.youtube.com/watch?v=dQw4w9WgXcQ';
      expect(YouTubeTranscriptApi.getVideoId(url)).toBe('dQw4w9WgXcQ');
    });

    it('should return the ID if already an ID', () => {
      const url = 'dQw4w9WgXcQ';
      expect(YouTubeTranscriptApi.getVideoId(url)).toBe('dQw4w9WgXcQ');
    });

    it('should return the input for invalid URL if it resembles an ID', () => {
      const url = 'invalid-url';
      expect(YouTubeTranscriptApi.getVideoId(url)).toBe('invalid-url');
    });

    it('should throw error if URL does not contain a video ID', () => {
      const url = 'https://www.youtube.com/watch';
      expect(() => YouTubeTranscriptApi.getVideoId(url)).toThrow('Could not extract video ID from');
    });

    it('should throw error if video ID is empty', () => {
      const url = 'https://www.youtube.com/watch?v=';
      expect(() => YouTubeTranscriptApi.getVideoId(url)).toThrow('Could not extract video ID from');
    });
  });
});
