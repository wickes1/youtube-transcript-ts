/* eslint-env jest */
/**
 * Public surface contract: every type the README tells consumers to pass or annotate must be
 * importable AND nameable from the package barrel. ts-jest runs with diagnostics.warnOnly:false,
 * so a missing export breaks compilation of this file -- the test failing to *build* is the signal.
 *
 * The audit flagged CacheOptions/LoggerOptions/InvidiousOptions/ProxyOptions and the
 * TranscriptList/TranscriptEntry classes as previously un-nameable; this pins them down.
 */
import {
  YouTubeTranscriptApi,
  TranscriptList,
  TranscriptEntry,
  FormatterFactory,
  Formatter,
  JSONFormatter,
  TextFormatter,
  SRTFormatter,
  WebVTTFormatter,
  VideoUnavailable,
  NoTranscriptFound,
  TranscriptsDisabled,
  NotTranslatable,
  TranslationLanguageNotAvailable,
  IpBlocked,
  RequestFailed,
  type YouTubeTranscriptApiOptions,
  type FetchTranscriptOptions,
  type CacheOptions,
  type LoggerOptions,
  type InvidiousOptions,
  type ProxyOptions,
  type Transcript,
  type TranscriptSnippet,
  type TranscriptResponse,
  type VideoMetadata,
  type ThumbnailInfo,
  type TranslationLanguage,
  type FormatterType,
} from '../src';

// Also assert the default export resolves to the same class.
import DefaultExport from '../src';

describe('public type + value surface', () => {
  it('exports the runtime values consumers import', () => {
    expect(typeof YouTubeTranscriptApi).toBe('function');
    expect(typeof TranscriptList).toBe('function');
    expect(typeof TranscriptEntry).toBe('function');
    expect(typeof FormatterFactory).toBe('function');
    expect(typeof Formatter).toBe('function');
    expect(typeof JSONFormatter).toBe('function');
    expect(typeof TextFormatter).toBe('function');
    expect(typeof SRTFormatter).toBe('function');
    expect(typeof WebVTTFormatter).toBe('function');
  });

  it('exports every error class as a real constructor', () => {
    for (const Err of [
      VideoUnavailable,
      NoTranscriptFound,
      TranscriptsDisabled,
      NotTranslatable,
      TranslationLanguageNotAvailable,
      IpBlocked,
      RequestFailed,
    ]) {
      expect(typeof Err).toBe('function');
    }
  });

  it('makes the default export the YouTubeTranscriptApi class', () => {
    expect(DefaultExport).toBe(YouTubeTranscriptApi);
  });

  it('lets consumers name the option and data types', () => {
    // If any of these type names were not exported, this file would not compile.
    const apiOpts: YouTubeTranscriptApiOptions = {
      cache: { enabled: true },
      logger: { enabled: false },
      invidious: { enabled: false, instanceUrls: '' },
      proxy: { enabled: false },
    };
    const fetchOpts: FetchTranscriptOptions = { languages: ['en'], formatter: 'text' };
    const cache: CacheOptions = { enabled: true, maxAge: 1000, maxSize: 10 };
    const logger: LoggerOptions = { enabled: true, namespace: 'x' };
    const invidious: InvidiousOptions = { enabled: false, instanceUrls: ['https://a'], timeout: 1 };
    const proxy: ProxyOptions = { enabled: false, http: '', https: '' };
    const snippet: TranscriptSnippet = { text: 't', start: 0, duration: 1 };
    const transcript: Transcript = {
      snippets: [snippet],
      videoId: 'v',
      language: 'English',
      languageCode: 'en',
      isGenerated: false,
    };
    const thumb: ThumbnailInfo = { url: 'u', width: 1, height: 1 };
    const meta: VideoMetadata = {
      id: 'v',
      title: 't',
      description: 'd',
      author: 'a',
      channelId: 'c',
      lengthSeconds: 1,
      viewCount: 1,
      isPrivate: false,
      isLiveContent: false,
      thumbnails: [thumb],
    };
    const response: TranscriptResponse = { transcript, metadata: meta };
    const lang: TranslationLanguage = { languageCode: 'de', languageName: 'German' };
    const fmt: FormatterType = 'json';

    expect(apiOpts.cache?.enabled).toBe(true);
    expect(fetchOpts.formatter).toBe('text');
    expect(cache.maxSize).toBe(10);
    expect(logger.namespace).toBe('x');
    expect(invidious.timeout).toBe(1);
    expect(proxy.enabled).toBe(false);
    expect(response.transcript.snippets).toHaveLength(1);
    expect(lang.languageCode).toBe('de');
    expect(fmt).toBe('json');
  });
});
