/* eslint-env jest */
import {
  FormatterFactory,
  JSONFormatter,
  TextFormatter,
  SRTFormatter,
  WebVTTFormatter,
} from '../src/formatters';
import { Transcript } from '../src/types';

describe('Formatters', () => {
  // Sample transcript data for testing
  const transcript: Transcript = {
    snippets: [
      { text: 'First line', start: 0, duration: 2.5 },
      { text: 'Second line', start: 2.5, duration: 3 },
      { text: 'Third line', start: 5.5, duration: 2 },
    ],
    videoId: 'test-video',
    language: 'English',
    languageCode: 'en',
    isGenerated: false,
  };

  const transcripts: Transcript[] = [
    transcript,
    {
      ...transcript,
      videoId: 'test-video-2',
      language: 'Spanish',
      languageCode: 'es',
    },
  ];

  describe('FormatterFactory', () => {
    it('should create JSONFormatter', () => {
      const formatter = FormatterFactory.create('json');
      expect(formatter).toBeInstanceOf(JSONFormatter);
    });

    it('should create TextFormatter', () => {
      const formatter = FormatterFactory.create('text');
      expect(formatter).toBeInstanceOf(TextFormatter);
    });

    it('should create SRTFormatter', () => {
      const formatter = FormatterFactory.create('srt');
      expect(formatter).toBeInstanceOf(SRTFormatter);
    });

    it('should create WebVTTFormatter', () => {
      const formatter = FormatterFactory.create('webvtt');
      expect(formatter).toBeInstanceOf(WebVTTFormatter);
    });

    it('should use JSONFormatter as default', () => {
      const formatter = FormatterFactory.create();
      expect(formatter).toBeInstanceOf(JSONFormatter);
    });

    it('should throw error for invalid format', () => {
      expect(() => FormatterFactory.create('invalid' as any)).toThrow();
    });
  });

  describe('JSONFormatter', () => {
    it('should format as JSON', () => {
      const formatter = new JSONFormatter();
      const result = formatter.format(transcript);

      expect(typeof result).toBe('string');

      // Should be valid JSON
      const parsed = JSON.parse(result);
      expect(parsed.snippets).toHaveLength(3);
      expect(parsed.videoId).toBe('test-video');
    });

    it('should format multiple transcripts as JSON array', () => {
      const formatter = new JSONFormatter();
      const result = formatter.formatTranscripts(transcripts);

      // Should be valid JSON array
      const parsed = JSON.parse(result);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].videoId).toBe('test-video');
      expect(parsed[1].videoId).toBe('test-video-2');
    });
  });

  describe('TextFormatter', () => {
    it('should format as plain text', () => {
      const formatter = new TextFormatter();
      const result = formatter.format(transcript);

      expect(typeof result).toBe('string');
      expect(result).toContain('First line');
      expect(result).toContain('Second line');
      expect(result).toContain('Third line');

      // Should have line breaks
      const lines = result.split('\n');
      expect(lines).toHaveLength(3);
    });

    it('should format multiple transcripts with separators', () => {
      const formatter = new TextFormatter();
      const result = formatter.formatTranscripts(transcripts);

      expect(result).toContain('First line');
      expect(result).toContain('\n\n\n'); // Check for separator
    });
  });

  describe('SRTFormatter', () => {
    it('should format as SRT', () => {
      const formatter = new SRTFormatter();
      const result = formatter.format(transcript);

      expect(typeof result).toBe('string');

      // Should contain sequence numbers
      expect(result).toContain('1\n');
      expect(result).toContain('2\n');
      expect(result).toContain('3\n');

      // Should contain timestamps
      expect(result).toContain('00:00:00,000');

      // Should contain text
      expect(result).toContain('First line');
    });

    it('should pad numbers correctly', () => {
      const bigTranscript: Transcript = {
        ...transcript,
        snippets: [
          { text: 'Test', start: 3600, duration: 10 }, // 1 hour
        ],
      };

      const formatter = new SRTFormatter();
      const result = formatter.format(bigTranscript);

      // Should pad hours correctly
      expect(result).toContain('01:00:00,000');
    });
  });

  describe('WebVTTFormatter', () => {
    it('should format as WebVTT', () => {
      const formatter = new WebVTTFormatter();
      const result = formatter.format(transcript);

      expect(typeof result).toBe('string');

      // Should have WebVTT header
      expect(result).toContain('WEBVTT');

      // Should contain timestamps
      expect(result).toContain('00:00:00.000');

      // Should contain text
      expect(result).toContain('First line');
    });

    it('should handle multiple transcripts', () => {
      const formatter = new WebVTTFormatter();
      const result = formatter.formatTranscripts(transcripts);

      // Should contain multiple TRANSCRIPT headers
      expect(result).toContain('TRANSCRIPT 1:');
      expect(result).toContain('TRANSCRIPT 2:');
    });
  });
});
