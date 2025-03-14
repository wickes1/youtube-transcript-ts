export interface TranscriptSnippet {
  text: string;
  start: number;
  duration: number;
}

export interface Transcript {
  snippets: TranscriptSnippet[];
  videoId: string;
  language: string;
  languageCode: string;
  isGenerated: boolean;
}

export interface TranslationLanguage {
  language: string;
  languageCode: string;
}

export interface VideoMetadata {
  id: string;
  title: string;
  description: string;
  author: string;
  channelId: string;
  lengthSeconds: number;
  viewCount: number;
  isPrivate: boolean;
  isLiveContent: boolean;
  publishDate?: string;
  category?: string;
  keywords?: string[];
  thumbnails?: ThumbnailInfo[];
}

export interface ThumbnailInfo {
  url: string;
  width: number;
  height: number;
}

/**
 * Standardized response format for transcript fetching
 * Contains all possible return data regardless of options used
 */
export interface TranscriptResponse {
  /** The transcript data */
  transcript: Transcript;
  /** Video metadata (always included) */
  metadata: VideoMetadata;
  /** Formatted text if a formatter was specified (undefined if no formatter used) */
  formattedText?: string;
}

export interface YouTubeTranscriptError extends Error {
  videoId: string;
}

export class VideoUnavailable extends Error implements YouTubeTranscriptError {
  constructor(public videoId: string) {
    super(`Video ${videoId} is unavailable`);
    this.name = 'VideoUnavailable';
  }
}

export class NoTranscriptFound extends Error implements YouTubeTranscriptError {
  constructor(
    public videoId: string,
    public languages: string[],
  ) {
    super(`No transcript found for video ${videoId} in languages: ${languages.join(', ')}`);
    this.name = 'NoTranscriptFound';
  }
}

export class TranscriptsDisabled extends Error implements YouTubeTranscriptError {
  constructor(public videoId: string) {
    super(`Transcripts are disabled for video ${videoId}`);
    this.name = 'TranscriptsDisabled';
  }
}

export class NotTranslatable extends Error implements YouTubeTranscriptError {
  constructor(public videoId: string) {
    super(`Transcript for video ${videoId} is not translatable`);
    this.name = 'NotTranslatable';
  }
}

export class TranslationLanguageNotAvailable extends Error implements YouTubeTranscriptError {
  constructor(public videoId: string) {
    super(`Translation language not available for video ${videoId}`);
    this.name = 'TranslationLanguageNotAvailable';
  }
}

export class IpBlocked extends Error implements YouTubeTranscriptError {
  constructor(public videoId: string) {
    super(`IP blocked for video ${videoId}`);
    this.name = 'IpBlocked';
  }
}

export class AgeRestricted extends Error implements YouTubeTranscriptError {
  constructor(public videoId: string) {
    super(`Age restricted video ${videoId}`);
    this.name = 'AgeRestricted';
  }
}

/**
 * Options for batch transcript retrieval
 */
export interface BatchTranscriptOptions {
  languages?: string[];
  preserveFormatting?: boolean;
  formatter?: 'json' | 'text' | 'srt' | 'webvtt';
  stopOnError?: boolean;
}
