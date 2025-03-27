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

export type FormatterType = 'text' | 'json' | 'srt' | 'webvtt';

export interface YouTubeTranscriptError {
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
    super(`Video ${videoId} is not translatable`);
    this.name = 'NotTranslatable';
  }
}

export class TranslationLanguageNotAvailable extends Error implements YouTubeTranscriptError {
  constructor(
    public videoId: string,
    public language: string,
  ) {
    super(`Translation language ${language} is not available for video ${videoId}`);
    this.name = 'TranslationLanguageNotAvailable';
  }
}

export class IpBlocked extends Error implements YouTubeTranscriptError {
  constructor(public videoId: string) {
    super(`IP blocked for video ${videoId}`);
    this.name = 'IpBlocked';
  }
}

export interface TranslationLanguage {
  languageCode: string;
  languageName: string;
}
