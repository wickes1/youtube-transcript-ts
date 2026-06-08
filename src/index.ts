// Main API
export { default, YouTubeTranscriptApi, TranscriptList, TranscriptEntry } from './api';

// Public option / configuration types
export type {
  YouTubeTranscriptApiOptions,
  FetchTranscriptOptions,
  CacheOptions,
  LoggerOptions,
  InvidiousOptions,
  ProxyOptions,
} from './api';

// Data types
export type {
  Transcript,
  TranscriptSnippet,
  TranscriptResponse,
  VideoMetadata,
  ThumbnailInfo,
  TranslationLanguage,
} from './types';

// Formatters
export {
  Formatter,
  FormatterFactory,
  JSONFormatter,
  TextFormatter,
  SRTFormatter,
  WebVTTFormatter,
} from './formatters';
export type { FormatterType } from './formatters';

// Errors
export {
  VideoUnavailable,
  NoTranscriptFound,
  TranscriptsDisabled,
  NotTranslatable,
  TranslationLanguageNotAvailable,
  IpBlocked,
  RequestFailed,
} from './types';
