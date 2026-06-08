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

/**
 * A retryable transport failure (timeout or 5xx) while fetching from YouTube/Invidious.
 * Distinct from {@link VideoUnavailable} so consumers can implement retry/backoff.
 * The originating error is preserved on `cause`.
 */
export class RequestFailed extends Error implements YouTubeTranscriptError {
  /** True for transient failures that may succeed on retry. */
  public readonly retryable = true;

  /**
   * The originating error (e.g. the underlying axios error). Declared as a real
   * member so it type-resolves on consumers using a pre-ES2022 lib (where
   * `Error.cause` does not exist).
   */
  public readonly cause?: unknown;

  constructor(
    public videoId: string,
    reason?: string,
    options?: { cause?: unknown },
  ) {
    super(`Request failed for video ${videoId}${reason ? `: ${reason}` : ''}`);
    this.name = 'RequestFailed';
    if (options && 'cause' in options) {
      this.cause = options.cause;
    }
  }
}

export interface TranslationLanguage {
  languageCode: string;
  languageName: string;
}
