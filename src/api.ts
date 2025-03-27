import axios, { AxiosInstance } from 'axios';
import { decode } from 'html-entities';
import { FormatterFactory, FormatterType } from './formatters';
import {
  BatchTranscriptOptions,
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
} from './types';

const WATCH_URL = 'https://www.youtube.com/watch';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)';

// Cache options interface
interface CacheOptions {
  enabled: boolean;
  maxAge: number; // milliseconds
}

// Cache entry interface
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// Logger options interface
interface LoggerOptions {
  enabled: boolean;
  namespace: string;
  /**
   * Custom logger function
   * Return true to prevent default logging behavior
   */
  logger?: (type: string, message: string, data?: any) => boolean;
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
 * Configuration options for the YouTubeTranscriptApi
 */
export interface YouTubeTranscriptApiOptions {
  /** Cache configuration options */
  cache?: Partial<CacheOptions>;
  /** Logger configuration options */
  logger?: Partial<LoggerOptions>;
  /** Invidious fallback configuration options */
  invidious?: Partial<InvidiousOptions>;
}

/**
 * Main YouTube Transcript API class for fetching and processing transcripts
 */
export class YouTubeTranscriptApi {
  private httpClient: AxiosInstance;
  private invidiousClient: AxiosInstance | null = null;
  private cache: {
    html: Map<string, CacheEntry<string>>;
    transcript: Map<string, CacheEntry<Transcript>>;
  };
  private cacheOptions: CacheOptions;
  private loggerOptions: LoggerOptions;
  private invidiousOptions: InvidiousOptions;

  /**
   * Create a new YouTubeTranscriptApi instance
   * @param options Configuration options for the API
   */
  constructor(options: YouTubeTranscriptApiOptions = {}) {
    // Initialize cache
    this.cache = {
      html: new Map(),
      transcript: new Map(),
    };

    // Default cache options
    this.cacheOptions = {
      enabled: true,
      maxAge: 3600000, // 1 hour default cache
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

    // Initialize Invidious client if enabled
    if (this.invidiousOptions.enabled) {
      const instanceUrls = Array.isArray(this.invidiousOptions.instanceUrls)
        ? this.invidiousOptions.instanceUrls
        : [this.invidiousOptions.instanceUrls];

      if (instanceUrls.length === 0 || (instanceUrls.length === 1 && !instanceUrls[0])) {
        throw new Error(
          'At least one Invidious instance URL must be provided when Invidious is enabled',
        );
      }

      this.initInvidiousClient();
    }

    // Configure axios with performance optimizations
    this.httpClient = axios.create({
      headers: {
        'Accept-Language': 'en-US',
        'User-Agent': USER_AGENT,
        'Accept-Encoding': 'gzip, deflate, br', // Enable compression
      },
      timeout: 10000, // 10 second timeout
      maxRedirects: 5,
      // We don't set keep-alive agents in browser environments
      ...(typeof window === 'undefined'
        ? {
            // Only use these in Node.js environments
            httpAgent: new (require('http').Agent)({
              keepAlive: true,
            }),
            httpsAgent: new (require('https').Agent)({
              keepAlive: true,
            }),
          }
        : {}),
    });
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
      const instanceUrls = Array.isArray(this.invidiousOptions.instanceUrls)
        ? this.invidiousOptions.instanceUrls
        : [this.invidiousOptions.instanceUrls];

      if (instanceUrls.length === 0 || (instanceUrls.length === 1 && !instanceUrls[0])) {
        throw new Error(
          'At least one Invidious instance URL must be provided when Invidious is enabled',
        );
      }

      this.initInvidiousClient();
    } else {
      this.invidiousClient = null;
    }
  }

  /**
   * Initialize the Invidious API client
   * @private
   */
  private initInvidiousClient(): void {
    // Get the first instance URL as the default
    const instanceUrls = Array.isArray(this.invidiousOptions.instanceUrls)
      ? this.invidiousOptions.instanceUrls
      : [this.invidiousOptions.instanceUrls];

    const primaryInstanceUrl = instanceUrls[0];

    this.invidiousClient = axios.create({
      baseURL: primaryInstanceUrl,
      timeout: this.invidiousOptions.timeout || 10000,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });

    // Store all instance URLs for fallback use
    (this.invidiousClient as any).__instanceUrls = instanceUrls;
    (this.invidiousClient as any).__currentInstanceIndex = 0;

    // Validate the Invidious instance by making a test request
    this.validateInvidiousInstance().catch(error => {
      this.log(
        'error',
        `Failed to validate primary Invidious instance at ${primaryInstanceUrl}`,
        error,
      );

      // If we have multiple instances, we'll try others when making actual requests
      if (instanceUrls.length > 1) {
        this.log('info', `Will try ${instanceUrls.length - 1} alternative instance(s) when needed`);
      } else {
        this.log('info', 'Invidious fallback will be disabled');
        this.invidiousClient = null;
      }
    });
  }

  /**
   * Validate that the configured Invidious instance is available and working
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

      const instanceUrls = Array.isArray(this.invidiousOptions.instanceUrls)
        ? this.invidiousOptions.instanceUrls
        : [this.invidiousOptions.instanceUrls];

      const primaryInstanceUrl = instanceUrls[0];

      this.log('info', `Successfully validated Invidious instance at ${primaryInstanceUrl}`);
      return true;
    } catch (error) {
      this.log('error', 'Invidious instance validation failed', error);
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

    const instanceUrls =
      (this.invidiousClient as any).__instanceUrls ||
      (Array.isArray(this.invidiousOptions.instanceUrls)
        ? this.invidiousOptions.instanceUrls
        : [this.invidiousOptions.instanceUrls]);

    let lastError: Error | null = null;

    // Try each instance in order
    for (let i = 0; i < instanceUrls.length; i++) {
      const instanceUrl = instanceUrls[i];

      try {
        // Update the client's base URL to the current instance
        this.invidiousClient.defaults.baseURL = instanceUrl;
        (this.invidiousClient as any).__currentInstanceIndex = i;

        this.log('info', `Trying Invidious instance: ${instanceUrl}`);
        return await operation(this.invidiousClient, instanceUrl);
      } catch (error) {
        this.log('error', `Failed with Invidious instance ${instanceUrl}`, error);
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
   * @param data Optional data to log
   * @private
   */
  private log(type: string, message: string, data?: any): void {
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
   * Clear the internal cache
   * @param type Optional cache type to clear (html, transcript, or both if undefined)
   */
  public clearCache(type?: 'html' | 'transcript'): void {
    if (!type || type === 'html') {
      this.cache.html.clear();
    }
    if (!type || type === 'transcript') {
      this.cache.transcript.clear();
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
    } catch (e) {
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
   * Fetch transcript for a video
   * @param videoIdOrUrl Video ID or YouTube URL
   * @param languages Optional array of language codes to try in order
   * @param preserveFormatting Whether to preserve text formatting
   * @param formatter Optional formatter to format the output
   * @returns TranscriptResponse with transcript data and metadata
   */
  public async fetchTranscript(
    videoIdOrUrl: string,
    languages: string[] = ['en'],
    preserveFormatting: boolean = false,
    formatter?: FormatterType,
  ): Promise<TranscriptResponse> {
    const startTotal = Date.now();
    const timings: Record<string, number> = {};
    const videoId = YouTubeTranscriptApi.getVideoId(videoIdOrUrl);

    const logPerformance = (step: string, startTime: number) => {
      const duration = Date.now() - startTime;
      timings[step] = duration;
      this.log('performance', `${step}: ${duration}ms`);
    };

    // Determine if we should try Invidious first based on conditions:
    // Invidious option is enabled and client is available
    const shouldTryInvidiousFirst = this.invidiousOptions.enabled && this.invidiousClient;

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
          invidiousError,
        );
        // Fall back to normal YouTube fetching process
      }
    }

    try {
      const htmlCacheKey = `html:${videoId}`;
      const transcriptCacheKey = `transcript:${videoId}:${languages.join(',')}:${preserveFormatting}`;

      // Check cache for transcript
      const cachedTranscript = this.cache.transcript.get(transcriptCacheKey);
      if (this.isCacheValid(cachedTranscript)) {
        this.log('performance', 'Using cached transcript');
        // Fetch HTML for metadata
        const html = await this.fetchVideoHtml(videoId);
        const metadata = this.extractMetadata(html);

        const response: TranscriptResponse = {
          transcript: cachedTranscript!.data,
          metadata,
          formattedText: undefined,
        };

        // Apply formatter if specified
        if (formatter) {
          const startFormatting = Date.now();
          response.formattedText = FormatterFactory.create(formatter).format(
            cachedTranscript!.data,
          );
          logPerformance('Apply Formatting', startFormatting);
        }

        return response;
      }

      // Fetch video HTML
      const startHtmlFetch = Date.now();
      let html: string;
      const cachedHtml = this.cache.html.get(htmlCacheKey);
      if (this.isCacheValid(cachedHtml)) {
        html = cachedHtml!.data;
        this.log('performance', 'Using cached HTML');
      } else {
        html = await this.fetchVideoHtml(videoId);
        // Store in cache
        this.cache.html.set(htmlCacheKey, {
          data: html,
          timestamp: Date.now(),
        });
      }
      logPerformance('HTML Fetch', startHtmlFetch);

      // Extract metadata
      const startMetadataExtract = Date.now();
      const metadata = this.extractMetadata(html);
      logPerformance('Metadata Extract', startMetadataExtract);

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
      this.cache.transcript.set(transcriptCacheKey, {
        data: transcriptData,
        timestamp: Date.now(),
      });

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
          this.log('error', `Invidious fallback also failed for video ${videoId}`, invidiousError);
          throw error; // Throw the original YouTube error
        }
      }

      // If Invidious is not enabled or also failed, rethrow the original error
      throw error;
    }
  }

  /**
   * Fetches a transcript from Invidious API
   * @param videoId YouTube video ID
   * @param languages List of language codes to search for (in order of preference)
   * @param preserveFormatting Whether to keep select HTML text formatting
   * @param formatter Optional formatter to format the output (json, text, srt, webvtt)
   * @returns TranscriptResponse with data from Invidious
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
            error,
          );
          throw new VideoUnavailable(videoId);
        });

        if (!videoResponse || !videoResponse.data) {
          this.log('error', `Empty response from Invidious for video ${videoId}`);
          throw new VideoUnavailable(videoId);
        }

        const videoData = videoResponse.data;

        // Extract metadata
        const metadata: VideoMetadata = {
          id: videoData.videoId,
          title: videoData.title,
          description: videoData.description || '',
          author: videoData.author,
          channelId: videoData.authorId,
          lengthSeconds: videoData.lengthSeconds || 0,
          viewCount: parseInt(videoData.viewCount || '0', 10),
          isPrivate: false, // Invidious doesn't provide this info
          isLiveContent: videoData.liveNow || false,
          publishDate: videoData.published || '',
          category: videoData.genre || '',
          keywords: videoData.keywords || [],
          thumbnails:
            videoData.videoThumbnails?.map((thumb: any) => ({
              url: thumb.url,
              width: thumb.width,
              height: thumb.height,
            })) || [],
        };

        // Get available captions from Invidious
        let captionsData;
        try {
          const captionsResponse = await client.get(`/api/v1/captions/${videoId}`);
          captionsData = captionsResponse.data;

          if (!captionsData || !Array.isArray(captionsData.captions)) {
            this.log('error', `Invalid captions data from Invidious for video ${videoId}`);
            throw new NoTranscriptFound(videoId, languages);
          }
        } catch (error) {
          this.log('error', `Failed to fetch captions from Invidious for video ${videoId}`, error);
          throw new NoTranscriptFound(videoId, languages);
        }

        // Find the best matching language
        let selectedCaptionTrack = null;
        for (const language of languages) {
          const track = captionsData.captions?.find((cap: any) => cap.languageCode === language);
          if (track) {
            selectedCaptionTrack = track;
            break;
          }
        }

        if (!selectedCaptionTrack) {
          throw new NoTranscriptFound(videoId, languages);
        }

        // Fetch the actual transcript data using the URL provided in the captions response
        let vttContent;
        try {
          // The URL is provided in the captionTrack from the API response
          const captionUrl = selectedCaptionTrack.url;
          if (!captionUrl) {
            throw new Error(
              `No caption URL found for language ${selectedCaptionTrack.languageCode}`,
            );
          }

          // The URL in the response is relative, we need to use it directly with the client
          const transcriptResponse = await client.get(captionUrl);
          vttContent = transcriptResponse.data;

          if (!vttContent || typeof vttContent !== 'string') {
            this.log('error', `Invalid transcript data from Invidious for video ${videoId}`);
            throw new Error('Invalid transcript data format from Invidious');
          }
        } catch (error) {
          this.log(
            'error',
            `Failed to fetch transcript data from Invidious for video ${videoId}`,
            error,
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
          language: selectedCaptionTrack.label || selectedCaptionTrack.languageCode,
          languageCode: selectedCaptionTrack.languageCode,
          isGenerated: selectedCaptionTrack.kind === 'asr',
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

        // Cache the result
        const transcriptCacheKey = `transcript:${videoId}:${languages.join(',')}:${preserveFormatting}`;
        this.cache.transcript.set(transcriptCacheKey, {
          data: transcript,
          timestamp: Date.now(),
        });

        return response;
      } catch (error) {
        this.log('error', `Error fetching from Invidious for video ${videoId}`, error);
        throw error; // Rethrow to allow trying the next instance
      }
    });
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

          // Clean the text if needed
          const text = preserveFormatting ? textContent : textContent.replace(/<[^>]*>/g, '');

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
      seconds = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
      // MM:SS.mmm
      seconds = parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
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
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 404 || status === 410) {
          throw new VideoUnavailable(videoId);
        }
        if (status === 403) {
          // Possible IP block or geo-restriction
          throw new IpBlocked(videoId);
        }
      }
      throw new VideoUnavailable(videoId);
    }
  }

  /**
   * Extract video metadata from HTML
   * @param html Video page HTML
   * @returns VideoMetadata object
   * @private
   */
  private extractMetadata(html: string): VideoMetadata {
    const metadataMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;/);
    if (!metadataMatch) {
      throw new Error('Could not extract video metadata');
    }

    try {
      const data = JSON.parse(metadataMatch[1]);
      const videoDetails = data.videoDetails;

      if (!videoDetails) {
        throw new Error(`No video details found`);
      }

      return {
        id: videoDetails.videoId,
        title: decode(videoDetails.title),
        description: decode(videoDetails.shortDescription),
        author: decode(videoDetails.author),
        channelId: videoDetails.channelId,
        lengthSeconds: parseInt(videoDetails.lengthSeconds, 10),
        viewCount: parseInt(videoDetails.viewCount, 10),
        isPrivate: videoDetails.isPrivate,
        isLiveContent: videoDetails.isLiveContent,
        publishDate: data.microformat?.playerMicroformatRenderer?.publishDate,
        category: data.microformat?.playerMicroformatRenderer?.category,
        keywords: videoDetails.keywords,
        thumbnails:
          videoDetails.thumbnail?.thumbnails?.map((thumb: any) => ({
            url: thumb.url,
            width: thumb.width,
            height: thumb.height,
          })) || [],
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
  private extractCaptionsJson(html: string, videoId: string): any {
    const splittedHTML = html.split('"captions":');

    if (splittedHTML.length <= 1) {
      if (html.includes('class="g-recaptcha"')) {
        throw new IpBlocked(videoId);
      }
      if (!html.includes('"playabilityStatus":')) {
        throw new VideoUnavailable(videoId);
      }
      throw new TranscriptsDisabled(videoId);
    }

    try {
      const captionsData = JSON.parse(
        splittedHTML[1].split(',"videoDetails')[0].replace('\n', ''),
      )?.['playerCaptionsTracklistRenderer'];

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
 * Internal class for managing transcript lists
 */
class TranscriptList {
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

  static build(httpClient: AxiosInstance, videoId: string, captionsJson: any): TranscriptList {
    const translationLanguages: TranslationLanguage[] = (
      captionsJson.translationLanguages || []
    ).map((lang: any) => ({
      languageName: lang.languageName.simpleText,
      languageCode: lang.languageCode,
    }));

    const manualTranscripts = new Map<string, TranscriptEntry>();
    const generatedTranscripts = new Map<string, TranscriptEntry>();

    (captionsJson.captionTracks || []).forEach((track: any) => {
      const transcript = new TranscriptEntry(
        httpClient,
        videoId,
        track.baseUrl,
        track.name.simpleText,
        track.languageCode,
        track.kind === 'asr',
        track.isTranslatable ? translationLanguages : [],
      );

      if (track.kind === 'asr') {
        generatedTranscripts.set(track.languageCode, transcript);
      } else {
        manualTranscripts.set(track.languageCode, transcript);
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
 * Internal class for transcript entries
 */
class TranscriptEntry {
  private static readonly RE_XML_TRANSCRIPT =
    /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
  private static readonly FORMATTING_TAGS = [
    'strong', // important
    'em', // emphasized
    'b', // bold
    'i', // italic
    'mark', // marked
    'small', // smaller
    'del', // deleted
    'ins', // inserted
    'sub', // subscript
    'sup', // superscript
  ];

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
    try {
      const response = await this.httpClient.get(this.url);
      const snippets = this.parseTranscript(response.data, preserveFormatting);

      return {
        snippets,
        videoId: this.videoId,
        language: this.language,
        languageCode: this.languageCode,
        isGenerated: this.isGenerated,
      };
    } catch (error) {
      throw new VideoUnavailable(this.videoId);
    }
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

    return new TranscriptEntry(
      this.httpClient,
      this.videoId,
      `${this.url}&tlang=${languageCode}`,
      translatedLanguage.languageName,
      languageCode,
      true,
      [],
    );
  }

  private isTranslatable(): boolean {
    return this.translationLanguages.length > 0;
  }

  private getHtmlRegex(preserveFormatting: boolean): RegExp {
    if (preserveFormatting) {
      const formatsRegex = TranscriptEntry.FORMATTING_TAGS.join('|');
      return new RegExp(`<\\/?(?!\\/?(?:${formatsRegex})\\b).*?\\b>`, 'gi');
    }
    return /<[^>]*>/gi;
  }

  private decodeAndClean(text: string): string {
    // First decode XML entities
    let decoded = text
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');

    // Then decode HTML entities
    decoded = decode(decoded);

    // Replace common YouTube-specific entities
    decoded = decoded
      .replace(/\\u0026/g, '&')
      .replace(/\\"/g, '"')
      .replace(/\\/g, '');

    return decoded;
  }

  private parseTranscript(xmlString: string, preserveFormatting: boolean): TranscriptSnippet[] {
    const snippets: TranscriptSnippet[] = [];
    let match;
    const htmlRegex = this.getHtmlRegex(preserveFormatting);

    // First decode the entire XML string to handle any escaped XML
    const decodedXml = this.decodeAndClean(xmlString);

    while ((match = TranscriptEntry.RE_XML_TRANSCRIPT.exec(decodedXml)) !== null) {
      const [, start, duration, text] = match;

      // Process the text content
      let processedText = this.decodeAndClean(text);

      if (!preserveFormatting) {
        // Remove HTML tags
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
        start: parseFloat(start),
        duration: parseFloat(duration),
      });
    }

    return snippets;
  }
}

// Default export
export default YouTubeTranscriptApi;
