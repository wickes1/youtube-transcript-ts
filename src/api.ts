import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { decode } from 'html-entities';
import { FormatterFactory, FormatterType } from './formatters';
import {
  NoTranscriptFound,
  NotTranslatable,
  Transcript,
  TranscriptResponse,
  TranscriptSnippet,
  TranslationLanguage,
  TranslationLanguageNotAvailable,
  VideoMetadata,
  VideoUnavailable,
  IpBlocked,
  TranscriptsDisabled,
  RequestFailed,
} from './types';
// Import proxy agents (Node-only). This library targets Node; there is no browser build.
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

const WATCH_URL = 'https://www.youtube.com/watch';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)';

// Upper bound on per-snippet decoded text length to defend against pathological/malicious caption payloads.
const MAX_SNIPPET_TEXT_LENGTH = 50_000;
// Bounded, ReDoS-safe HTML tag matcher (no unbounded `[^>]*`).
const TAG_STRIP_REGEX = /<\/?[a-zA-Z][^>]{0,256}>/g;

/**
 * Cache configuration options.
 */
export interface CacheOptions {
  /** Enable in-memory caching (default: true) */
  enabled: boolean;
  /** Maximum entry lifetime in milliseconds (default: 3600000) */
  maxAge: number;
  /** Maximum number of entries per cache before LRU eviction (default: 100) */
  maxSize: number;
}

// Cache entry interface
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Logger configuration options.
 */
export interface LoggerOptions {
  /** Enable logging (default: false) */
  enabled: boolean;
  /** Log namespace prefix (default: 'youtube-transcript') */
  namespace: string;
  /**
   * Custom logger function.
   * Return true to prevent the default logging behavior.
   * The `data` payload is untrusted (it may be a sanitized error or a timings object).
   */
  logger?: (type: string, message: string, data?: unknown) => boolean;
}

/**
 * Invidious configuration options for fallback when YouTube blocks requests
 */
export interface InvidiousOptions {
  /** Enable Invidious fallback (default: false) */
  enabled: boolean;
  /**
   * Invidious instance URL(s). Can be a single URL string or an array of URLs for fallback.
   * If an array is provided, instances will be tried in order until one works.
   */
  instanceUrls: string | string[];
  /** Timeout in milliseconds for Invidious requests (default: 10000) */
  timeout?: number;
}

/**
 * Proxy configuration options for HTTP/HTTPS requests
 */
export interface ProxyOptions {
  /** Enable proxy for requests (default: false) */
  enabled: boolean;
  /** The HTTP proxy URL (e.g., 'http://user:pass@proxy.example.com:8080') */
  http?: string;
  /** The HTTPS proxy URL (e.g., 'http://user:pass@proxy.example.com:8080') */
  https?: string;
}

/**
 * Configuration options for the YouTubeTranscriptApi
 */
export interface YouTubeTranscriptApiOptions {
  /** Cache configuration options */
  cache?: Partial<CacheOptions>;
  /** Logger configuration options */
  logger?: Partial<LoggerOptions>;
  /** Invidious fallback configuration options */
  invidious?: Partial<InvidiousOptions>;
  /** Proxy configuration options */
  proxy?: Partial<ProxyOptions>;
}

/**
 * Options-object form of {@link YouTubeTranscriptApi.fetchTranscript}.
 */
export interface FetchTranscriptOptions {
  /** Language codes to try, in order of preference (default: ['en']) */
  languages?: string[];
  /** Whether to preserve inline HTML formatting tags in the text (default: false) */
  preserveFormatting?: boolean;
  /** Optional formatter applied to the result (json | text | srt | webvtt) */
  formatter?: FormatterType;
}

/**
 * Sanitized error shape suitable for logging. Never carries the raw axios error,
 * whose `config` can include proxy credentials (httpsAgent.proxy) and Cookie headers.
 */
interface SanitizedError {
  message: string;
  code?: string;
  status?: number;
}

// --- Raw JSON boundary types (untrusted remote shapes) ---------------------

interface RawSimpleText {
  simpleText?: string;
}

interface RawCaptionTrack {
  baseUrl?: string;
  name?: RawSimpleText;
  languageCode?: string;
  kind?: string;
  isTranslatable?: boolean;
}

interface RawTranslationLanguage {
  languageCode?: string;
  languageName?: RawSimpleText;
}

interface RawCaptionsTracklist {
  captionTracks?: RawCaptionTrack[];
  translationLanguages?: RawTranslationLanguage[];
}

interface RawThumbnail {
  url?: string;
  width?: number;
  height?: number;
}

interface RawVideoDetails {
  videoId?: string;
  title?: string;
  shortDescription?: string;
  author?: string;
  channelId?: string;
  lengthSeconds?: string;
  viewCount?: string;
  isPrivate?: boolean;
  isLiveContent?: boolean;
  keywords?: string[];
  thumbnail?: { thumbnails?: RawThumbnail[] };
}

interface RawPlayerResponse {
  videoDetails?: RawVideoDetails;
  microformat?: {
    playerMicroformatRenderer?: {
      publishDate?: string;
      category?: string;
    };
  };
}

interface RawInvidiousCaption {
  url?: string;
  label?: string;
  languageCode?: string;
}

interface RawInvidiousCaptionsResponse {
  captions?: RawInvidiousCaption[];
}

interface RawInvidiousVideo {
  videoId?: string;
  title?: string;
  description?: string;
  author?: string;
  authorId?: string;
  lengthSeconds?: number | string;
  viewCount?: number | string;
  liveNow?: boolean;
  published?: string;
  genre?: string;
  keywords?: string[];
  videoThumbnails?: RawThumbnail[];
}

/**
 * Coerce a possibly-missing/NaN numeric field to a finite number, defaulting to 0.
 */
function toNum(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Reduce an unknown error (typically an axios error) to a safe, log-friendly shape.
 * Strips config (proxy credentials, Cookie header) and any other ambient state.
 */
function sanitizeError(error: unknown): SanitizedError {
  if (axios.isAxiosError(error)) {
    return {
      message: error.message,
      code: error.code,
      status: error.response?.status,
    };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
}

/**
 * Find the balanced `{...}` object that begins at `startIndex` (which must point at `{`).
 * String-literal and escape aware, so `};` or unbalanced braces inside string values
 * (e.g. code snippets in a video description) do not truncate the capture.
 * Returns the substring including the outer braces, or null if unbalanced.
 */
function extractBalancedObject(source: string, startIndex: number): string | null {
  if (source[startIndex] !== '{') {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < source.length; i++) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

/**
 * Build the keep-alive agents used by every axios client this library creates.
 * Node-only (the library imports node:http / node:https and proxy agents).
 */
function buildAgents(proxy: ProxyOptions): { httpAgent: http.Agent; httpsAgent: https.Agent } {
  if (proxy.enabled) {
    return {
      httpAgent: new HttpProxyAgent(proxy.http || ''),
      httpsAgent: new HttpsProxyAgent(proxy.https || proxy.http || ''),
    };
  }
  return {
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),
  };
}

/**
 * Destroy keep-alive/proxy agents attached to an axios client so the underlying
 * socket pool is released instead of leaking when the client is replaced.
 */
function destroyAgents(client: AxiosInstance | null): void {
  if (!client) return;
  const { httpAgent, httpsAgent } = client.defaults;
  if (httpAgent && typeof (httpAgent as http.Agent).destroy === 'function') {
    (httpAgent as http.Agent).destroy();
  }
  if (httpsAgent && typeof (httpsAgent as https.Agent).destroy === 'function') {
    (httpsAgent as https.Agent).destroy();
  }
}

/**
 * Main YouTube Transcript API class for fetching and processing transcripts.
 *
 * Trust boundary: HTML and JSON returned by YouTube and Invidious are untrusted.
 * All remote shapes are narrowed at the JSON boundary, caption text length is capped,
 * and Invidious caption URLs are pinned to the instance origin (see fetchTranscriptFromInvidious).
 */
export class YouTubeTranscriptApi {
  private httpClient: AxiosInstance;
  private invidiousClient: AxiosInstance | null = null;
  /** Instance URLs the Invidious client may fail over across (typed; replaces monkey-patching). */
  private invidiousInstanceUrls: string[] = [];
  /** True once the primary Invidious instance has been validated (lazy). */
  private invidiousValidated = false;
  private cache: {
    html: Map<string, CacheEntry<string>>;
    transcript: Map<string, CacheEntry<Transcript>>;
    metadata: Map<string, CacheEntry<VideoMetadata>>;
  };
  private cacheOptions: CacheOptions;
  private loggerOptions: LoggerOptions;
  private invidiousOptions: InvidiousOptions;
  private proxyOptions: ProxyOptions;

  /**
   * Create a new YouTubeTranscriptApi instance
   * @param options Configuration options for the API
   */
  constructor(options: YouTubeTranscriptApiOptions = {}) {
    // Initialize cache
    this.cache = {
      html: new Map(),
      transcript: new Map(),
      metadata: new Map(),
    };

    // Default cache options
    this.cacheOptions = {
      enabled: true,
      maxAge: 3600000, // 1 hour default cache
      maxSize: 100,
      ...options.cache,
    };

    // Default logger options
    this.loggerOptions = {
      enabled: false,
      namespace: 'youtube-transcript',
      ...options.logger,
    };

    // Default Invidious options (no default instance URL)
    this.invidiousOptions = {
      enabled: false,
      instanceUrls: '',
      timeout: 10000,
      ...options.invidious,
    };

    // Default proxy options
    this.proxyOptions = {
      enabled: false,
      http: '',
      https: '',
      ...options.proxy,
    };

    // Configure the primary YouTube HTTP client.
    this.httpClient = this.buildHttpClient();

    // Initialize Invidious client if enabled
    if (this.invidiousOptions.enabled) {
      this.assertInvidiousInstancesConfigured();
      this.initInvidiousClient();
    }
  }

  /**
   * Build an axios client with this instance's standard headers, timeout,
   * keep-alive (or proxy) agents, and optional overrides.
   * Single source of truth for client construction (constructor, setProxyOptions, initInvidiousClient).
   * @private
   */
  private buildHttpClient(overrides: AxiosRequestConfig = {}): AxiosInstance {
    const agents = buildAgents(this.proxyOptions);

    const config: AxiosRequestConfig = {
      headers: {
        'Accept-Language': 'en-US',
        'User-Agent': USER_AGENT,
        'Accept-Encoding': 'gzip, deflate, br',
      },
      timeout: 10000,
      maxRedirects: 5,
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
      // When proxying, disable axios's built-in proxy resolver so the agents are used.
      ...(this.proxyOptions.enabled ? { proxy: false } : {}),
      ...overrides,
    };

    return axios.create(config);
  }

  /**
   * Configure logging behavior
   * @param options Logger configuration options
   */
  public setLoggerOptions(options: Partial<LoggerOptions>): void {
    this.loggerOptions = {
      ...this.loggerOptions,
      ...options,
    };
  }

  /**
   * Configure caching behavior
   * @param options Cache configuration options
   */
  public setCacheOptions(options: Partial<CacheOptions>): void {
    this.cacheOptions = {
      ...this.cacheOptions,
      ...options,
    };
  }

  /**
   * Configure proxy settings for all requests
   * @param options Proxy configuration options
   */
  public setProxyOptions(options: Partial<ProxyOptions>): void {
    const next: ProxyOptions = {
      ...this.proxyOptions,
      ...options,
    };

    // Only rebuild clients when the effective proxy config actually changed.
    const changed =
      next.enabled !== this.proxyOptions.enabled ||
      next.http !== this.proxyOptions.http ||
      next.https !== this.proxyOptions.https;

    this.proxyOptions = next;

    if (!changed) {
      return;
    }

    // Preserve any Cookie set before the proxy change.
    const prevCookie = this.httpClient.defaults.headers.common['Cookie'];

    // Release the old socket pool before replacing the client.
    destroyAgents(this.httpClient);
    this.httpClient = this.buildHttpClient();

    if (prevCookie) {
      this.httpClient.defaults.headers.common['Cookie'] = prevCookie;
    }

    // Reinitialize Invidious client if it's enabled (it also carries proxy agents).
    if (this.invidiousOptions.enabled) {
      this.initInvidiousClient();
    }
  }

  /**
   * Configure Invidious fallback behavior
   * @param options Invidious configuration options
   */
  public setInvidiousOptions(options: Partial<InvidiousOptions>): void {
    this.invidiousOptions = {
      ...this.invidiousOptions,
      ...options,
    };

    // Initialize or update Invidious client if enabled
    if (this.invidiousOptions.enabled) {
      this.assertInvidiousInstancesConfigured();
      this.initInvidiousClient();
    } else {
      destroyAgents(this.invidiousClient);
      this.invidiousClient = null;
      this.invidiousInstanceUrls = [];
    }
  }

  /**
   * Normalize the configured Invidious instance URLs into an array.
   * @private
   */
  private resolveInvidiousInstanceUrls(): string[] {
    return Array.isArray(this.invidiousOptions.instanceUrls)
      ? this.invidiousOptions.instanceUrls
      : [this.invidiousOptions.instanceUrls];
  }

  /**
   * Throw if Invidious is enabled but no instance URL was provided.
   * @private
   */
  private assertInvidiousInstancesConfigured(): void {
    const instanceUrls = this.resolveInvidiousInstanceUrls();
    if (instanceUrls.length === 0 || (instanceUrls.length === 1 && !instanceUrls[0])) {
      throw new Error(
        'At least one Invidious instance URL must be provided when Invidious is enabled',
      );
    }
  }

  /**
   * Initialize the Invidious API client
   * @private
   */
  private initInvidiousClient(): void {
    const instanceUrls = this.resolveInvidiousInstanceUrls();
    const primaryInstanceUrl = instanceUrls[0];

    // Release any previous Invidious socket pool before replacing the client.
    destroyAgents(this.invidiousClient);

    this.invidiousClient = this.buildHttpClient({
      baseURL: primaryInstanceUrl,
      timeout: this.invidiousOptions.timeout || 10000,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      // Caption URLs come from untrusted instance JSON; never let an absolute URL
      // override baseURL, and never follow redirects (SSRF hardening).
      allowAbsoluteUrls: false,
      maxRedirects: 0,
    });

    this.invidiousInstanceUrls = instanceUrls;
    this.invidiousValidated = false;
  }

  /**
   * Validate that the configured Invidious instance is available and working.
   * Lazy: invoked on first use rather than fired un-awaited from the constructor.
   * @private
   */
  private async validateInvidiousInstance(): Promise<boolean> {
    if (!this.invidiousClient) {
      return false;
    }

    try {
      // Make a simple request to the Invidious API to check if it's working
      const response = await this.invidiousClient.get('/api/v1/stats', {
        timeout: 5000, // Short timeout for this test
      });

      if (response.status !== 200) {
        this.log('error', `Invidious instance returned non-200 status: ${response.status}`);
        return false;
      }

      const primaryInstanceUrl = this.invidiousInstanceUrls[0];
      this.log('info', `Successfully validated Invidious instance at ${primaryInstanceUrl}`);
      return true;
    } catch (error) {
      this.log('error', 'Invidious instance validation failed', sanitizeError(error));
      return false;
    }
  }

  /**
   * Tries to get an Invidious instance that works
   * @param operation The operation to perform with the client
   * @returns The result of the operation
   * @private
   */
  private async tryWithInvidiousInstances<T>(
    operation: (client: AxiosInstance, instanceUrl: string) => Promise<T>,
  ): Promise<T> {
    if (!this.invidiousClient) {
      throw new Error('Invidious client not initialized');
    }

    // Lazily validate the primary instance the first time it is actually used.
    if (!this.invidiousValidated) {
      this.invidiousValidated = true;
      await this.validateInvidiousInstance();
    }

    const instanceUrls =
      this.invidiousInstanceUrls.length > 0
        ? this.invidiousInstanceUrls
        : this.resolveInvidiousInstanceUrls();

    let lastError: Error | null = null;

    // Try each instance in order
    for (let i = 0; i < instanceUrls.length; i++) {
      const instanceUrl = instanceUrls[i];

      try {
        // Update the client's base URL to the current instance
        this.invidiousClient.defaults.baseURL = instanceUrl;

        this.log('info', `Trying Invidious instance: ${instanceUrl}`);
        return await operation(this.invidiousClient, instanceUrl);
      } catch (error) {
        this.log('error', `Failed with Invidious instance ${instanceUrl}`, sanitizeError(error));
        lastError = error as Error;
        // Continue to the next instance
      }
    }

    // If we get here, all instances failed
    throw lastError || new Error('All Invidious instances failed');
  }

  /**
   * Sets cookies for authentication (useful for age-restricted videos)
   * @param cookies Dictionary of cookie name-value pairs
   */
  public setCookies(cookies: Record<string, string>): void {
    // Update axios instance with cookies
    const cookieString = Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');

    this.httpClient.defaults.headers.common['Cookie'] = cookieString;
  }

  /**
   * Internal method to log messages
   * @param type Type of log (e.g., 'performance', 'error')
   * @param message Log message
   * @param data Optional data to log (untrusted; route errors through sanitizeError first)
   * @private
   */
  private log(type: string, message: string, data?: unknown): void {
    if (!this.loggerOptions.enabled) return;

    const { namespace, logger } = this.loggerOptions;
    const prefix = namespace ? `${namespace}:${type}` : type;

    // Use custom logger if provided
    if (logger && logger(type, message, data)) {
      return; // Custom logger handled it (returned true)
    }

    // Default logging behavior
    if (data !== undefined) {
      console.log(`[${prefix}] ${message}`, data);
    } else {
      console.log(`[${prefix}] ${message}`);
    }
  }

  /**
   * Clear the internal cache.
   *
   * Cached video metadata follows the transcript-cache lifecycle: it is cleared by
   * `clearCache('transcript')` or by `clearCache()` (no argument), never by
   * `clearCache('html')`.
   *
   * @param type Optional cache type to clear (html, transcript, or both if undefined)
   */
  public clearCache(type?: 'html' | 'transcript'): void {
    if (!type || type === 'html') {
      this.cache.html.clear();
    }
    if (!type || type === 'transcript') {
      this.cache.transcript.clear();
      this.cache.metadata.clear();
    }
  }

  /**
   * Extracts video ID from various YouTube URL formats or returns the ID if already an ID
   * @param videoIdOrUrl Video ID or YouTube URL (various formats supported)
   * @returns Extracted video ID
   */
  public static getVideoId(videoIdOrUrl: string): string {
    if (!videoIdOrUrl) {
      throw new Error('Video ID or URL cannot be empty');
    }

    // Already a video ID (not a URL)
    if (!videoIdOrUrl.includes('/') && !videoIdOrUrl.includes('.')) {
      return videoIdOrUrl;
    }

    // Try to parse as URL
    let url: URL;
    try {
      url = new URL(videoIdOrUrl);
    } catch {
      throw new Error(`Invalid YouTube URL or video ID: ${videoIdOrUrl}`);
    }

    // youtu.be short URL format
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1);
      if (id) return id;
    }

    // youtube.com domain
    if (
      url.hostname === 'youtube.com' ||
      url.hostname === 'www.youtube.com' ||
      url.hostname === 'm.youtube.com'
    ) {
      // Standard watch URL with query parameter v=ID
      if (url.pathname === '/watch') {
        const id = url.searchParams.get('v');
        if (id) return id;
      }

      // Shorts format
      if (url.pathname.startsWith('/shorts/')) {
        const id = url.pathname.slice('/shorts/'.length);
        if (id) return id.split('/')[0];
      }

      // Embed format
      if (url.pathname.startsWith('/embed/')) {
        const id = url.pathname.slice('/embed/'.length);
        if (id) return id.split('/')[0];
      }

      // Live format
      if (url.pathname.startsWith('/live/')) {
        const id = url.pathname.slice('/live/'.length);
        if (id) return id.split('/')[0];
      }
    }

    throw new Error(`Could not extract video ID from: ${videoIdOrUrl}`);
  }

  /**
   * Check if a cached entry is still valid
   * @param entry The cache entry to check
   * @returns True if the entry is valid, false if expired
   * @private
   */
  private isCacheValid<T>(entry?: CacheEntry<T>): boolean {
    if (!this.cacheOptions.enabled || !entry) return false;
    return Date.now() - entry.timestamp < this.cacheOptions.maxAge;
  }

  /**
   * Insert into a cache with insertion-order LRU eviction and bounded size.
   * @private
   */
  private cacheSet<T>(store: Map<string, CacheEntry<T>>, key: string, data: T): void {
    if (!this.cacheOptions.enabled) return;
    // Refresh recency: delete then re-set so the key moves to the end.
    store.delete(key);
    store.set(key, { data, timestamp: Date.now() });
    while (store.size > this.cacheOptions.maxSize) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }

  /**
   * Read a still-valid entry from a cache, deleting it if expired.
   * @private
   */
  private cacheGet<T>(store: Map<string, CacheEntry<T>>, key: string): T | undefined {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (!this.isCacheValid(entry)) {
      store.delete(key);
      return undefined;
    }
    return entry.data;
  }

  /**
   * Pure cache-hit fast path: when BOTH the transcript and its metadata are cached,
   * build the response (applying the formatter) with zero network round-trips. Returns
   * undefined when either is missing so the caller proceeds to fetch.
   *
   * Source-independent: called once at the top of fetchTranscript (before the
   * Invidious-first branch) so Invidious-first does not bypass the cache.
   * @private
   */
  private tryCacheHit(
    videoId: string,
    languages: string[],
    preserveFormatting: boolean,
    formatter?: FormatterType,
  ): TranscriptResponse | undefined {
    const transcriptCacheKey = `transcript:${videoId}:${languages.join(',')}:${preserveFormatting}`;
    const metadataCacheKey = `metadata:${videoId}`;

    const cachedTranscript = this.cacheGet(this.cache.transcript, transcriptCacheKey);
    const cachedMetadata = this.cacheGet(this.cache.metadata, metadataCacheKey);
    if (!cachedTranscript || !cachedMetadata) {
      return undefined;
    }

    // Pure cache hit: zero network round-trips.
    this.log('performance', 'Using cached transcript');

    const response: TranscriptResponse = {
      transcript: cachedTranscript,
      metadata: cachedMetadata,
      formattedText: undefined,
    };

    if (formatter) {
      response.formattedText = FormatterFactory.create(formatter).format(cachedTranscript);
    }

    return response;
  }

  /**
   * Fetch transcript for a video.
   *
   * @param videoIdOrUrl Video ID or YouTube URL
   * @param options Options object (`{ languages?, preserveFormatting?, formatter? }`)
   */
  public async fetchTranscript(
    videoIdOrUrl: string,
    options?: FetchTranscriptOptions,
  ): Promise<TranscriptResponse>;
  /**
   * Fetch transcript for a video (positional form).
   *
   * @deprecated Prefer the options-object overload:
   * `fetchTranscript(idOrUrl, { languages, preserveFormatting, formatter })`.
   * The positional form is a boolean trap and may be removed in a future major.
   */
  public async fetchTranscript(
    videoIdOrUrl: string,
    languages?: string[],
    preserveFormatting?: boolean,
    formatter?: FormatterType,
  ): Promise<TranscriptResponse>;
  public async fetchTranscript(
    videoIdOrUrl: string,
    languagesOrOptions: string[] | FetchTranscriptOptions = ['en'],
    preserveFormattingArg: boolean = false,
    formatterArg?: FormatterType,
  ): Promise<TranscriptResponse> {
    // Normalize the two call shapes into a single options bag.
    let languages: string[];
    let preserveFormatting: boolean;
    let formatter: FormatterType | undefined;

    if (Array.isArray(languagesOrOptions)) {
      languages = languagesOrOptions;
      preserveFormatting = preserveFormattingArg;
      formatter = formatterArg;
    } else {
      languages = languagesOrOptions.languages ?? ['en'];
      preserveFormatting = languagesOrOptions.preserveFormatting ?? false;
      formatter = languagesOrOptions.formatter;
    }

    const startTotal = Date.now();
    const timings: Record<string, number> = {};
    const videoId = YouTubeTranscriptApi.getVideoId(videoIdOrUrl);

    const logPerformance = (step: string, startTime: number) => {
      const duration = Date.now() - startTime;
      timings[step] = duration;
      this.log('performance', `${step}: ${duration}ms`);
    };

    // Cache fast path FIRST (before Invidious-first), so a repeat call never re-hits the
    // network regardless of which source originally populated the cache.
    const startCacheCheck = Date.now();
    const cacheHit = this.tryCacheHit(videoId, languages, preserveFormatting, formatter);
    if (cacheHit) {
      logPerformance('Apply Formatting', startCacheCheck);
      return cacheHit;
    }

    // Determine if we should try Invidious first based on conditions:
    // Invidious option is enabled and client is available
    const shouldTryInvidiousFirst = this.invidiousOptions.enabled && !!this.invidiousClient;

    // If we should try Invidious first, do that before attempting YouTube
    if (shouldTryInvidiousFirst) {
      this.log('info', `Attempting to get transcript via Invidious first for video ${videoId}`);
      const startInvidiousFetch = Date.now();

      try {
        const response = await this.fetchTranscriptFromInvidious(
          videoId,
          languages,
          preserveFormatting,
          formatter,
        );

        logPerformance('Invidious First Attempt', startInvidiousFetch);
        this.log('info', `Successfully fetched transcript from Invidious for video ${videoId}`);

        return response;
      } catch (invidiousError) {
        this.log(
          'error',
          `Invidious first attempt failed for video ${videoId}, falling back to YouTube`,
          sanitizeError(invidiousError),
        );
        // Fall back to normal YouTube fetching process
      }
    }

    try {
      const htmlCacheKey = `html:${videoId}`;
      const transcriptCacheKey = `transcript:${videoId}:${languages.join(',')}:${preserveFormatting}`;
      const metadataCacheKey = `metadata:${videoId}`;

      // The pure transcript+metadata cache hit is handled by tryCacheHit() at the top of
      // fetchTranscript. Here we only need the transcript-cached-but-metadata-stale case:
      // read the cached transcript so we can return it once fresh metadata is extracted.
      const cachedTranscript = this.cacheGet(this.cache.transcript, transcriptCacheKey);

      // Fetch video HTML (consulting / populating the html cache)
      const startHtmlFetch = Date.now();
      let html = this.cacheGet(this.cache.html, htmlCacheKey);
      if (html !== undefined) {
        this.log('performance', 'Using cached HTML');
      } else {
        html = await this.fetchVideoHtml(videoId);
        this.cacheSet(this.cache.html, htmlCacheKey, html);
      }
      logPerformance('HTML Fetch', startHtmlFetch);

      // Extract metadata
      const startMetadataExtract = Date.now();
      const metadata = this.extractMetadata(html);
      this.cacheSet(this.cache.metadata, metadataCacheKey, metadata);
      logPerformance('Metadata Extract', startMetadataExtract);

      // If the transcript itself was cached, we now have fresh metadata; return without fetching it again.
      if (cachedTranscript) {
        const response: TranscriptResponse = {
          transcript: cachedTranscript,
          metadata,
          formattedText: undefined,
        };
        if (formatter) {
          const startFormatting = Date.now();
          response.formattedText = FormatterFactory.create(formatter).format(cachedTranscript);
          logPerformance('Apply Formatting', startFormatting);
        }
        return response;
      }

      // Extract captions data
      const startCaptionsExtract = Date.now();
      const captionsJson = this.extractCaptionsJson(html, videoId);
      logPerformance('Captions Extract', startCaptionsExtract);

      // Build transcript list
      const startBuildList = Date.now();
      const transcriptList = TranscriptList.build(this.httpClient, videoId, captionsJson);
      logPerformance('Build Transcript List', startBuildList);

      // Find appropriate language
      const startFindTranscript = Date.now();
      const transcript = await transcriptList.findTranscript(languages);
      logPerformance('Find Transcript', startFindTranscript);

      // Fetch transcript content
      const startFetchContent = Date.now();
      const transcriptData = await transcript.fetch(preserveFormatting);
      logPerformance('Fetch Content', startFetchContent);

      // Store transcript in cache
      this.cacheSet(this.cache.transcript, transcriptCacheKey, transcriptData);

      const response: TranscriptResponse = {
        transcript: transcriptData,
        metadata: metadata,
        formattedText: undefined,
      };

      // Apply formatter if specified
      if (formatter) {
        const startFormatting = Date.now();
        response.formattedText = FormatterFactory.create(formatter).format(transcriptData);
        logPerformance('Apply Formatting', startFormatting);
      }

      logPerformance('Total', startTotal);
      this.log('performance', 'Summary', timings);

      return response;
    } catch (error) {
      // If YouTube fetch fails and Invidious fallback is enabled (and we haven't tried it yet), try Invidious
      if (this.invidiousOptions.enabled && this.invidiousClient && !shouldTryInvidiousFirst) {
        this.log('info', `YouTube fetch failed, falling back to Invidious for video ${videoId}`);
        const startInvidiousFetch = Date.now();

        try {
          const response = await this.fetchTranscriptFromInvidious(
            videoId,
            languages,
            preserveFormatting,
            formatter,
          );

          logPerformance('Invidious Fallback', startInvidiousFetch);
          this.log('info', `Successfully fetched transcript from Invidious for video ${videoId}`);

          return response;
        } catch (invidiousError) {
          this.log(
            'error',
            `Invidious fallback also failed for video ${videoId}`,
            sanitizeError(invidiousError),
          );
          throw error; // Throw the original YouTube error
        }
      }

      // If Invidious is not enabled or also failed, rethrow the original error
      throw error;
    }
  }

  /**
   * Fetches a transcript from Invidious API.
   *
   * SECURITY / trust boundary: `captionUrl` originates from untrusted remote Invidious
   * JSON. A malicious or compromised instance could point it at cloud metadata
   * (169.254.169.254), localhost admin ports, or other internal hosts. We therefore
   * resolve it against the instance origin, reject any cross-origin or
   * private/loopback/link-local target, and fetch only its path+query. The client is
   * additionally configured with `allowAbsoluteUrls:false` and `maxRedirects:0`.
   *
   * @private
   */
  private async fetchTranscriptFromInvidious(
    videoId: string,
    languages: string[] = ['en'],
    preserveFormatting: boolean = false,
    formatter?: FormatterType,
  ): Promise<TranscriptResponse> {
    if (!this.invidiousClient) {
      throw new Error('Invidious client not initialized');
    }

    return this.tryWithInvidiousInstances(async (client, instanceUrl) => {
      try {
        // First get video info from Invidious
        const videoResponse = await client.get(`/api/v1/videos/${videoId}`).catch(error => {
          this.log(
            'error',
            `Failed to fetch video info from Invidious for video ${videoId}`,
            sanitizeError(error),
          );
          throw new VideoUnavailable(videoId);
        });

        if (!videoResponse || !videoResponse.data) {
          this.log('error', `Empty response from Invidious for video ${videoId}`);
          throw new VideoUnavailable(videoId);
        }

        const videoData = videoResponse.data as RawInvidiousVideo;

        // Extract metadata
        const metadata: VideoMetadata = {
          id: videoData.videoId ?? videoId,
          title: videoData.title ?? '',
          description: videoData.description || '',
          author: videoData.author ?? '',
          channelId: videoData.authorId ?? '',
          lengthSeconds: toNum(videoData.lengthSeconds),
          viewCount: toNum(videoData.viewCount),
          isPrivate: false, // Invidious doesn't provide this info
          isLiveContent: videoData.liveNow || false,
          publishDate: videoData.published || '',
          category: videoData.genre || '',
          keywords: videoData.keywords || [],
          thumbnails: (videoData.videoThumbnails ?? []).map(thumb => ({
            url: thumb.url ?? '',
            width: toNum(thumb.width),
            height: toNum(thumb.height),
          })),
        };

        // Get available captions from Invidious
        let captionsData: RawInvidiousCaptionsResponse;
        try {
          const captionsResponse = await client.get(`/api/v1/captions/${videoId}`);
          captionsData = captionsResponse.data as RawInvidiousCaptionsResponse;

          if (!captionsData || !Array.isArray(captionsData.captions)) {
            this.log('error', `Invalid captions data from Invidious for video ${videoId}`);
            throw new NoTranscriptFound(videoId, languages);
          }
        } catch (error) {
          this.log(
            'error',
            `Failed to fetch captions from Invidious for video ${videoId}`,
            sanitizeError(error),
          );
          throw new NoTranscriptFound(videoId, languages);
        }

        // Find the best matching language
        let selectedCaptionTrack: RawInvidiousCaption | null = null;
        for (const language of languages) {
          const track = captionsData.captions?.find(cap => cap.languageCode === language);
          if (track) {
            selectedCaptionTrack = track;
            break;
          }
        }

        if (!selectedCaptionTrack) {
          throw new NoTranscriptFound(videoId, languages);
        }

        // Fetch the actual transcript data using the URL provided in the captions response.
        let vttContent: string;
        try {
          const rawCaptionUrl = selectedCaptionTrack.url;
          if (!rawCaptionUrl) {
            throw new Error(
              `No caption URL found for language ${selectedCaptionTrack.languageCode}`,
            );
          }

          // SSRF guard: pin to the instance origin and fetch only path+query.
          const safePath = this.resolveInvidiousCaptionPath(rawCaptionUrl, instanceUrl);
          const transcriptResponse = await client.get(safePath);
          const body = transcriptResponse.data;

          if (!body || typeof body !== 'string') {
            this.log('error', `Invalid transcript data from Invidious for video ${videoId}`);
            throw new Error('Invalid transcript data format from Invidious');
          }
          vttContent = body;
        } catch (error) {
          this.log(
            'error',
            `Failed to fetch transcript data from Invidious for video ${videoId}`,
            sanitizeError(error),
          );
          throw new NoTranscriptFound(videoId, languages);
        }

        // Parse the WebVTT format returned by Invidious
        const snippets: TranscriptSnippet[] = this.parseWebVTT(vttContent, preserveFormatting);

        if (snippets.length === 0) {
          this.log('error', `Empty transcript from Invidious for video ${videoId}`);
          throw new NoTranscriptFound(videoId, languages);
        }

        const transcript: Transcript = {
          snippets,
          videoId,
          language: selectedCaptionTrack.label || selectedCaptionTrack.languageCode || '',
          languageCode: selectedCaptionTrack.languageCode || '',
          isGenerated: false,
        };

        // Create the response object
        const response: TranscriptResponse = {
          transcript,
          metadata,
          formattedText: undefined,
        };

        // Apply formatter if specified
        if (formatter) {
          response.formattedText = FormatterFactory.create(formatter).format(transcript);
        }

        // Cache the result (transcript + metadata) so repeat hits are network-free.
        const transcriptCacheKey = `transcript:${videoId}:${languages.join(',')}:${preserveFormatting}`;
        this.cacheSet(this.cache.transcript, transcriptCacheKey, transcript);
        this.cacheSet(this.cache.metadata, `metadata:${videoId}`, metadata);

        return response;
      } catch (error) {
        this.log(
          'error',
          `Error fetching from Invidious for video ${videoId}`,
          sanitizeError(error),
        );
        throw error; // Rethrow to allow trying the next instance
      }
    });
  }

  /**
   * Resolve an Invidious caption URL against the instance origin and return only the
   * path+query that is safe to request. Rejects cross-origin targets and
   * private/loopback/link-local hosts.
   * @private
   */
  private resolveInvidiousCaptionPath(captionUrl: string, instanceUrl: string): string {
    const instance = new URL(instanceUrl);
    const resolved = new URL(captionUrl, instanceUrl);

    if (resolved.origin !== instance.origin) {
      throw new Error(`Refusing cross-origin Invidious caption URL: ${resolved.origin}`);
    }
    if (YouTubeTranscriptApi.isBlockedHost(resolved.hostname)) {
      throw new Error('Refusing Invidious caption URL targeting a private/loopback host');
    }

    return `${resolved.pathname}${resolved.search}`;
  }

  /**
   * Heuristic block-list for SSRF-sensitive hosts (loopback, link-local, private ranges).
   * @private
   */
  private static isBlockedHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    // Strip surrounding brackets from IPv6 literals (e.g. `[fc00::1]` -> `fc00::1`).
    const ipLiteral = host.replace(/^\[|\]$/g, '');

    if (host === 'localhost' || ipLiteral === '::1' || ipLiteral === '0.0.0.0') {
      return true;
    }

    // IPv4 dotted-quad ranges
    const ipv4 = ipLiteral.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
      if (a === 127) return true; // loopback
      if (a === 10) return true; // private
      if (a === 0) return true; // "this" network
      if (a === 169 && b === 254) return true; // link-local (cloud metadata)
      if (a === 172 && b >= 16 && b <= 31) return true; // private
      if (a === 192 && b === 168) return true; // private
    }

    // IPv6 unique-local (fc00::/7) / link-local (fe80::/10). Gate on the value
    // actually being an IPv6 literal so DNS names that merely start with these
    // letters (e.g. `fdroid.example.com`) are not over-blocked.
    if (
      net.isIP(ipLiteral) === 6 &&
      (ipLiteral.startsWith('fc') || ipLiteral.startsWith('fd') || ipLiteral.startsWith('fe80'))
    ) {
      return true;
    }

    return false;
  }

  /**
   * Parses WebVTT format returned by Invidious
   * @param vttContent The WebVTT content as string
   * @param preserveFormatting Whether to preserve HTML formatting
   * @returns Array of transcript snippets
   */
  private parseWebVTT(vttContent: string, preserveFormatting: boolean): TranscriptSnippet[] {
    const snippets: TranscriptSnippet[] = [];

    // Split by lines and process
    const lines = vttContent.split('\n');
    let i = 0;

    // Skip header (usually WEBVTT or empty lines at the start)
    while (
      i < lines.length &&
      (lines[i].trim() === '' || lines[i].trim().startsWith('WEBVTT') || !lines[i].includes('-->'))
    ) {
      i++;
    }

    // Process cues
    while (i < lines.length) {
      const line = lines[i].trim();

      // Check if this is a timestamp line
      if (line.includes('-->')) {
        const times = line.split('-->').map(t => t.trim());
        if (times.length === 2) {
          const startTime = this.timeToSeconds(times[0]);
          const endTime = this.timeToSeconds(times[1]);
          const duration = endTime - startTime;

          // Get the text content (usually in the next line)
          i++;
          let textContent = '';

          // Collect all text lines until we hit an empty line or another timestamp
          while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
            if (textContent) textContent += '\n';
            textContent += lines[i].trim();
            i++;
          }

          // Clean the text if needed (bounded length + ReDoS-safe tag strip).
          const capped = textContent.slice(0, MAX_SNIPPET_TEXT_LENGTH);
          const text = preserveFormatting ? capped : capped.replace(TAG_STRIP_REGEX, '');

          if (text.trim()) {
            snippets.push({
              text: text.trim(),
              start: startTime,
              duration: duration,
            });
          }

          // Skip any empty lines before the next timestamp
          while (i < lines.length && lines[i].trim() === '') {
            i++;
          }

          continue;
        }
      }

      // If we're here, move to the next line
      i++;
    }

    return snippets;
  }

  /**
   * Converts WebVTT timestamp to seconds
   * @param timestamp WebVTT timestamp (HH:MM:SS.mmm)
   * @returns Time in seconds
   */
  private timeToSeconds(timestamp: string): number {
    const parts = timestamp.split(':');
    let seconds = 0;

    if (parts.length === 3) {
      // HH:MM:SS.mmm
      seconds = toNum(parts[0]) * 3600 + toNum(parts[1]) * 60 + toNum(parts[2]);
    } else if (parts.length === 2) {
      // MM:SS.mmm
      seconds = toNum(parts[0]) * 60 + toNum(parts[1]);
    } else {
      // Invalid format
      seconds = 0;
    }

    return seconds;
  }

  /**
   * Fetch video HTML content
   * @param videoId Video ID
   * @returns HTML content as string
   * @private
   */
  private async fetchVideoHtml(videoId: string): Promise<string> {
    try {
      const response = await this.httpClient.get(WATCH_URL, {
        params: { v: videoId },
      });

      if (response.status !== 200) {
        throw new VideoUnavailable(videoId);
      }

      return response.data;
    } catch (error) {
      throw this.mapHttpError(error, videoId);
    }
  }

  /**
   * Map an axios/content error to the appropriate typed library error.
   * 403 -> IpBlocked, 404/410 -> VideoUnavailable. Retryable -> RequestFailed for
   * 429 (throttling), transport failures (no response: ECONNRESET/ECONNREFUSED/EPIPE/
   * EAI_AGAIN/ETIMEDOUT/ECONNABORTED), timeouts, and 5xx. Unknown -> VideoUnavailable.
   * @private
   */
  private mapHttpError(error: unknown, videoId: string): Error {
    // Already a typed library error: pass through unchanged.
    if (
      error instanceof VideoUnavailable ||
      error instanceof IpBlocked ||
      error instanceof TranscriptsDisabled ||
      error instanceof NoTranscriptFound ||
      error instanceof RequestFailed
    ) {
      return error;
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 403) {
        return new IpBlocked(videoId);
      }
      if (status === 404 || status === 410) {
        return new VideoUnavailable(videoId);
      }
      // Retryable: throttling (429), any transport failure (no response at all:
      // ECONNRESET/ECONNREFUSED/EPIPE/EAI_AGAIN/ETIMEDOUT/ECONNABORTED), or 5xx.
      // Preserve the cause for consumer backoff logic. 429 is NOT IpBlocked.
      if (status === 429 || !error.response || (typeof status === 'number' && status >= 500)) {
        return new RequestFailed(videoId, error.message, { cause: error });
      }
    }

    return new VideoUnavailable(videoId);
  }

  /**
   * Extract video metadata from HTML
   * @param html Video page HTML
   * @returns VideoMetadata object
   * @private
   */
  private extractMetadata(html: string): VideoMetadata {
    const anchor = html.match(/ytInitialPlayerResponse\s*=\s*/);
    if (!anchor || anchor.index === undefined) {
      throw new Error('Could not extract video metadata');
    }

    const objectStart = anchor.index + anchor[0].length;
    const jsonText = extractBalancedObject(html, objectStart);
    if (!jsonText) {
      throw new Error('Could not extract video metadata');
    }

    try {
      const data = JSON.parse(jsonText) as RawPlayerResponse;
      const videoDetails = data.videoDetails;

      if (!videoDetails) {
        throw new Error(`No video details found`);
      }

      const microformat = data.microformat?.playerMicroformatRenderer;

      return {
        id: videoDetails.videoId ?? '',
        title: decode(videoDetails.title ?? ''),
        description: decode(videoDetails.shortDescription ?? ''),
        author: decode(videoDetails.author ?? ''),
        channelId: videoDetails.channelId ?? '',
        lengthSeconds: toNum(videoDetails.lengthSeconds),
        viewCount: toNum(videoDetails.viewCount),
        isPrivate: videoDetails.isPrivate ?? false,
        isLiveContent: videoDetails.isLiveContent ?? false,
        publishDate: microformat?.publishDate,
        category: microformat?.category,
        keywords: videoDetails.keywords,
        thumbnails: (videoDetails.thumbnail?.thumbnails ?? []).map(thumb => ({
          url: thumb.url ?? '',
          width: toNum(thumb.width),
          height: toNum(thumb.height),
        })),
      };
    } catch (error) {
      throw new Error(`Failed to parse video metadata: ${(error as Error).message}`);
    }
  }

  /**
   * Retrieves the list of available transcripts for a video
   * @param videoIdOrUrl The ID or URL of the video
   * @returns A transcript list with available transcripts
   */
  public async listTranscripts(videoIdOrUrl: string): Promise<TranscriptList> {
    const videoId = YouTubeTranscriptApi.getVideoId(videoIdOrUrl);
    const html = await this.fetchVideoHtml(videoId);
    const captionsJson = this.extractCaptionsJson(html, videoId);
    return TranscriptList.build(this.httpClient, videoId, captionsJson);
  }

  /**
   * Extract captions data from HTML
   * @param html Video page HTML
   * @param videoId Video ID for error reporting
   * @returns Captions data object
   * @private
   */
  private extractCaptionsJson(html: string, videoId: string): RawCaptionsTracklist {
    const marker = '"captions":';
    const markerIndex = html.indexOf(marker);

    if (markerIndex === -1) {
      if (html.includes('class="g-recaptcha"')) {
        throw new IpBlocked(videoId);
      }
      if (!html.includes('"playabilityStatus":')) {
        throw new VideoUnavailable(videoId);
      }
      throw new TranscriptsDisabled(videoId);
    }

    try {
      // Walk the balanced object that IMMEDIATELY follows the "captions": marker, rather
      // than jumping to the next `{` anywhere downstream (which would grab a neighbor
      // object when captions is null / an array / a non-object). Skip only whitespace.
      let scan = markerIndex + marker.length;
      while (scan < html.length && /\s/.test(html[scan])) {
        scan++;
      }
      if (html[scan] !== '{') {
        // captions is null, an array, or otherwise not an object: transcripts disabled.
        throw new TranscriptsDisabled(videoId);
      }

      const captionsObjectText = extractBalancedObject(html, scan);

      if (!captionsObjectText) {
        throw new TranscriptsDisabled(videoId);
      }

      const captionsContainer = JSON.parse(captionsObjectText) as {
        playerCaptionsTracklistRenderer?: RawCaptionsTracklist;
      };
      const captionsData = captionsContainer.playerCaptionsTracklistRenderer;

      if (!captionsData) {
        throw new TranscriptsDisabled(videoId);
      }

      if (!('captionTracks' in captionsData)) {
        throw new NoTranscriptFound(videoId, []);
      }

      return captionsData;
    } catch (error) {
      if (
        error instanceof VideoUnavailable ||
        error instanceof TranscriptsDisabled ||
        error instanceof NoTranscriptFound ||
        error instanceof IpBlocked
      ) {
        throw error;
      }
      throw new TranscriptsDisabled(videoId);
    }
  }
}

/**
 * Manages the set of available transcripts (manual, generated, translatable) for a video.
 * Returned by {@link YouTubeTranscriptApi.listTranscripts}.
 */
export class TranscriptList {
  private manualTranscripts: Map<string, TranscriptEntry>;
  private generatedTranscripts: Map<string, TranscriptEntry>;
  private translationLanguages: TranslationLanguage[];

  constructor(
    private videoId: string,
    manualTranscripts: Map<string, TranscriptEntry>,
    generatedTranscripts: Map<string, TranscriptEntry>,
    translationLanguages: TranslationLanguage[],
  ) {
    this.manualTranscripts = manualTranscripts;
    this.generatedTranscripts = generatedTranscripts;
    this.translationLanguages = translationLanguages;
  }

  /**
   * @internal Builds a TranscriptList from an untrusted captions object. Accepts `unknown`
   * (so the internal `RawCaptionsTracklist` shape does not leak into the public .d.ts) and
   * narrows defensively. Not part of the supported public API.
   */
  static build(httpClient: AxiosInstance, videoId: string, captionsJson: unknown): TranscriptList {
    // Narrow the untrusted shape once; every field access below is already guarded.
    const captions = (captionsJson ?? {}) as RawCaptionsTracklist;

    const translationLanguages: TranslationLanguage[] = (captions.translationLanguages || []).map(
      lang => ({
        languageName: lang.languageName?.simpleText ?? '',
        languageCode: lang.languageCode ?? '',
      }),
    );

    const manualTranscripts = new Map<string, TranscriptEntry>();
    const generatedTranscripts = new Map<string, TranscriptEntry>();

    (captions.captionTracks || []).forEach(track => {
      const languageCode = track.languageCode ?? '';
      const transcript = new TranscriptEntry(
        httpClient,
        videoId,
        track.baseUrl ?? '',
        track.name?.simpleText ?? '',
        languageCode,
        track.kind === 'asr',
        track.isTranslatable ? translationLanguages : [],
      );

      if (track.kind === 'asr') {
        generatedTranscripts.set(languageCode, transcript);
      } else {
        manualTranscripts.set(languageCode, transcript);
      }
    });

    return new TranscriptList(
      videoId,
      manualTranscripts,
      generatedTranscripts,
      translationLanguages,
    );
  }

  public async findTranscript(languageCodes: string[]): Promise<TranscriptEntry> {
    // Try manual transcripts first
    try {
      return this.findTranscriptInMap(languageCodes, this.manualTranscripts);
    } catch (error) {
      if (error instanceof NoTranscriptFound) {
        // Try generated transcripts if no manual transcript found
        return this.findTranscriptInMap(languageCodes, this.generatedTranscripts);
      }
      throw error;
    }
  }

  private findTranscriptInMap(
    languageCodes: string[],
    transcriptMap: Map<string, TranscriptEntry>,
  ): TranscriptEntry {
    for (const languageCode of languageCodes) {
      const transcript = transcriptMap.get(languageCode);
      if (transcript) {
        return transcript;
      }
    }
    throw new NoTranscriptFound(this.videoId, languageCodes);
  }
}

/**
 * A single transcript track. Returned via {@link TranscriptList.findTranscript};
 * call {@link TranscriptEntry.fetch} to download it or {@link TranscriptEntry.translate}
 * to obtain a translated variant.
 */
export class TranscriptEntry {
  private static readonly RE_XML_TRANSCRIPT =
    /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;

  /** @internal */
  constructor(
    private httpClient: AxiosInstance,
    private videoId: string,
    private url: string,
    private language: string,
    private languageCode: string,
    private isGenerated: boolean,
    private translationLanguages: TranslationLanguage[],
  ) {}

  public async fetch(preserveFormatting: boolean = false): Promise<Transcript> {
    let response;
    try {
      response = await this.httpClient.get(this.url);
    } catch (error) {
      // Map transport errors to typed library errors instead of a blanket VideoUnavailable.
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 403) {
          throw new IpBlocked(this.videoId);
        }
        if (status === 404 || status === 410) {
          throw new VideoUnavailable(this.videoId);
        }
        // Retryable: throttling (429), any transport failure (no response: ECONNRESET/
        // ECONNREFUSED/EPIPE/EAI_AGAIN/ETIMEDOUT/ECONNABORTED), or 5xx. 429 is NOT IpBlocked.
        if (status === 429 || !error.response || (typeof status === 'number' && status >= 500)) {
          throw new RequestFailed(this.videoId, error.message, { cause: error });
        }
      }
      // Unknown error: fall back to VideoUnavailable.
      throw new VideoUnavailable(this.videoId);
    }

    const snippets = this.parseTranscript(response.data, preserveFormatting);

    // A non-matching payload (attribute reorder, non-XML body, etc.) yields zero snippets.
    // Surface that as NoTranscriptFound instead of silently returning an empty transcript,
    // mirroring the Invidious path which already guards empty snippets.
    if (snippets.length === 0) {
      throw new NoTranscriptFound(this.videoId, [this.languageCode]);
    }

    return {
      snippets,
      videoId: this.videoId,
      language: this.language,
      languageCode: this.languageCode,
      isGenerated: this.isGenerated,
    };
  }

  public async translate(languageCode: string): Promise<TranscriptEntry> {
    if (!this.isTranslatable()) {
      throw new NotTranslatable(this.videoId);
    }

    if (!this.translationLanguages.some(lang => lang.languageCode === languageCode)) {
      throw new TranslationLanguageNotAvailable(this.videoId, languageCode);
    }

    const translatedLanguage = this.translationLanguages.find(
      lang => lang.languageCode === languageCode,
    )!;

    // Build the translated URL via the URL API rather than string-appending '&tlang='.
    const translatedUrl = new URL(this.url);
    translatedUrl.searchParams.set('tlang', languageCode);

    return new TranscriptEntry(
      this.httpClient,
      this.videoId,
      translatedUrl.toString(),
      translatedLanguage.languageName,
      languageCode,
      true,
      [],
    );
  }

  private isTranslatable(): boolean {
    return this.translationLanguages.length > 0;
  }

  private decodeText(text: string): string {
    // Decode XML entities, then HTML entities, then a narrow set of YouTube escapes.
    let decoded = text
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');

    decoded = decode(decoded);

    decoded = decoded.replace(/\\u0026/g, '&').replace(/\\"/g, '"');

    return decoded;
  }

  /**
   * Run the `<text start dur>` matcher over a single source string, building snippets.
   * The captured text group is decoded; tags are stripped (bounded, ReDoS-safe) unless
   * formatting is preserved.
   */
  private collectSnippets(source: string, preserveFormatting: boolean): TranscriptSnippet[] {
    const snippets: TranscriptSnippet[] = [];

    // Use matchAll so we never share a mutable lastIndex across calls.
    for (const match of source.matchAll(TranscriptEntry.RE_XML_TRANSCRIPT)) {
      const [, start, duration, rawText] = match;

      // Cap length before any expansion to bound decode/strip work.
      let processedText = this.decodeText(rawText.slice(0, MAX_SNIPPET_TEXT_LENGTH));

      if (!preserveFormatting) {
        // Remove HTML tags with the bounded matcher (no unbounded `[^>]*`).
        const htmlRegex = new RegExp(TAG_STRIP_REGEX.source, 'gi');
        processedText = processedText.replace(htmlRegex, '');

        // Normalize whitespace
        processedText = processedText
          .replace(/\s+/g, ' ')
          .replace(/&#160;/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .trim();
      }

      snippets.push({
        text: processedText,
        start: toNum(start),
        duration: toNum(duration),
      });
    }

    return snippets;
  }

  private parseTranscript(xmlString: string, preserveFormatting: boolean): TranscriptSnippet[] {
    // Primary path: run the regex against the RAW xml so escaped `</>` inside the text
    // group survive; decode ONLY the captured text.
    const snippets = this.collectSnippets(xmlString, preserveFormatting);
    if (snippets.length > 0) {
      return snippets;
    }

    // Fallback (v1.3.0 behavior): a fully-escaped document (e.g. Invidious returning
    // `&lt;text...&gt;`) has zero raw matches. Decode the WHOLE document once and retry.
    // This only runs on zero matches, so it never reintroduces the truncation bug.
    const decoded = this.decodeText(xmlString);
    return this.collectSnippets(decoded, preserveFormatting);
  }
}

// Default export
export default YouTubeTranscriptApi;
