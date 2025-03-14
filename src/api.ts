import axios, { AxiosInstance } from 'axios';
import { decode } from 'html-entities';
import { FormatterFactory, FormatterType } from './formatters';
import {
  BatchTranscriptOptions,
  IpBlocked,
  NoTranscriptFound,
  NotTranslatable,
  Transcript,
  TranscriptResponse,
  TranscriptsDisabled,
  TranscriptSnippet,
  TranslationLanguage,
  TranslationLanguageNotAvailable,
  VideoMetadata,
  VideoUnavailable,
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

/**
 * Logger interface for controlling how performance data is logged
 */
export interface LoggerOptions {
  /** Enable logging (default: false) */
  enabled: boolean;
  /**
   * Custom logger function (defaults to console.log with library prefix)
   * Return true to prevent default logging behavior
   */
  logger?: (type: string, message: string, data?: any) => boolean;
  /** Namespace prefix for logs (default: 'youtube-transcript') */
  namespace?: string;
}

/**
 * Main YouTube Transcript API class for fetching and processing transcripts
 */
export class YouTubeTranscriptApi {
  private httpClient: AxiosInstance;
  private cache: {
    html: Map<string, CacheEntry<string>>;
    transcript: Map<string, CacheEntry<Transcript>>;
  };
  private cacheOptions: CacheOptions;
  private loggerOptions: LoggerOptions;

  constructor(cacheOptions?: Partial<CacheOptions>, loggerOptions?: Partial<LoggerOptions>) {
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

    // Initialize cache
    this.cache = {
      html: new Map(),
      transcript: new Map(),
    };

    // Default cache options
    this.cacheOptions = {
      enabled: true,
      maxAge: 3600000, // 1 hour default cache
      ...cacheOptions,
    };

    // Default logger options
    this.loggerOptions = {
      enabled: false,
      namespace: 'youtube-transcript',
      ...loggerOptions,
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
   * Fetches the transcript for a single video with optimized performance
   * @param videoIdOrUrl Video ID or YouTube URL (various formats supported)
   * @param languages List of language codes to search for (in order of preference)
   * @param preserveFormatting Whether to keep select HTML text formatting
   * @param formatter Optional formatter to format the output (json, text, srt, webvtt)
   * @returns A standardized TranscriptResponse object containing transcript data, video metadata, and optionally formatted text
   */
  public async fetchTranscript(
    videoIdOrUrl: string,
    languages: string[] = ['en'],
    preserveFormatting: boolean = false,
    formatter?: FormatterType,
  ): Promise<TranscriptResponse> {
    const startTotal = Date.now();
    const timings: Record<string, number> = {};

    const logPerformance = (step: string, startTime: number) => {
      const duration = Date.now() - startTime;
      timings[step] = duration;
      this.log('performance', `${step}: ${duration}ms`);
    };

    const videoId = YouTubeTranscriptApi.getVideoId(videoIdOrUrl);

    // Generate cache keys
    const htmlCacheKey = `html:${videoId}`;
    const transcriptCacheKey = `transcript:${videoId}:${languages.join(',')}:${preserveFormatting}`;

    // Try to get transcript from cache first
    const cachedTranscript = this.cache.transcript.get(transcriptCacheKey);
    if (this.isCacheValid(cachedTranscript)) {
      this.log('performance', 'Using cached transcript data');

      // We still need metadata even when using cached transcript
      let metadata: VideoMetadata;

      // Fetch HTML (try cache first)
      const startHtmlFetch = Date.now();
      const cachedHtml = this.cache.html.get(htmlCacheKey);
      let html: string;

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
      metadata = this.extractMetadataFromHtml(html, videoId);
      logPerformance('Metadata Extract', startMetadataExtract);

      const response: TranscriptResponse = {
        transcript: cachedTranscript!.data,
        metadata: metadata,
        formattedText: undefined,
      };

      // Apply formatter if specified
      if (formatter) {
        const startFormatting = Date.now();
        response.formattedText = FormatterFactory.create(formatter).format(cachedTranscript!.data);
        logPerformance('Apply Formatting', startFormatting);
      }

      logPerformance('Total (From Cache)', startTotal);
      this.log('performance', 'Summary (Cached)', timings);

      return response;
    }

    // Fetch HTML (try cache first)
    const startHtmlFetch = Date.now();
    const cachedHtml = this.cache.html.get(htmlCacheKey);
    let html: string;

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
    const metadata = this.extractMetadataFromHtml(html, videoId);
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
    logPerformance('Fetch Transcript Content', startFetchContent);

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
  }

  /**
   * Fetches transcripts for multiple videos in batch
   * @param videoIds Array of video IDs or URLs
   * @param options Batch options including languages, formatting preferences
   * @returns Object with successful transcripts and failed items with errors
   */
  public async fetchTranscripts(
    videoIds: string[],
    options: BatchTranscriptOptions = {},
  ): Promise<{
    results: Record<string, TranscriptResponse>;
    errors: Record<string, Error>;
  }> {
    const {
      languages = ['en'],
      preserveFormatting = false,
      formatter,
      stopOnError = false,
    } = options;

    const results: Record<string, TranscriptResponse> = {};
    const errors: Record<string, Error> = {};

    // Log batch processing start
    this.log('performance', `Starting batch processing of ${videoIds.length} videos`);
    const batchStartTime = Date.now();

    // Process videos in batches of 3 to avoid overwhelming the network
    const batchSize = 3;
    for (let i = 0; i < videoIds.length; i += batchSize) {
      const batch = videoIds.slice(i, i + batchSize);

      this.log(
        'info',
        `Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(videoIds.length / batchSize)}`,
      );
      const batchStartTime = Date.now();

      // Process batch in parallel
      const batchPromises = batch.map(async videoIdOrUrl => {
        try {
          const videoId = YouTubeTranscriptApi.getVideoId(videoIdOrUrl);
          const transcript = await this.fetchTranscript(
            videoId,
            languages,
            preserveFormatting,
            formatter,
          );
          return { videoId, transcript, error: null };
        } catch (error) {
          const videoId = YouTubeTranscriptApi.getVideoId(videoIdOrUrl);
          return { videoId, transcript: null, error: error as Error };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      const batchDuration = Date.now() - batchStartTime;
      this.log('performance', `Batch completed in ${batchDuration}ms`);

      // Process batch results
      for (const result of batchResults) {
        if (result.error) {
          errors[result.videoId] = result.error;
          this.log('error', `Failed to fetch transcript for ${result.videoId}`, result.error);

          if (stopOnError) {
            // Stop processing if requested
            this.log('info', 'Stopping batch processing due to error (stopOnError=true)');
            return { results, errors };
          }
        } else if (result.transcript) {
          results[result.videoId] = result.transcript;
          this.log('info', `Successfully fetched transcript for ${result.videoId}`);
        }
      }
    }

    const totalDuration = Date.now() - batchStartTime;
    this.log('performance', `Batch processing completed in ${totalDuration}ms`, {
      totalVideos: videoIds.length,
      successful: Object.keys(results).length,
      failed: Object.keys(errors).length,
    });

    return { results, errors };
  }

  /**
   * Extract metadata from HTML without making additional requests
   * @param html The HTML content of the video page
   * @param videoId YouTube video ID for error reporting
   * @returns Video metadata object
   * @private
   */
  private extractMetadataFromHtml(html: string, videoId: string): VideoMetadata {
    const metadataMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);

    if (!metadataMatch) {
      throw new Error(`Failed to extract metadata for video ${videoId}`);
    }

    try {
      const data = JSON.parse(metadataMatch[1]);
      const videoDetails = data.videoDetails;

      if (!videoDetails) {
        throw new Error(`No video details found for video ${videoId}`);
      }

      return {
        id: videoDetails.videoId,
        title: videoDetails.title,
        description: videoDetails.shortDescription,
        author: videoDetails.author,
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
      throw new Error(`Failed to parse metadata for video ${videoId}: ${(error as Error).message}`);
    }
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
   * Retrieves the list of available transcripts for a video
   * @param videoIdOrUrl The ID or URL of the video
   */
  public async listTranscripts(videoIdOrUrl: string): Promise<TranscriptList> {
    const videoId = YouTubeTranscriptApi.getVideoId(videoIdOrUrl);
    const html = await this.fetchVideoHtml(videoId);
    const captionsJson = this.extractCaptionsJson(html, videoId);
    return TranscriptList.build(this.httpClient, videoId, captionsJson);
  }

  private async fetchVideoHtml(videoId: string): Promise<string> {
    try {
      const response = await this.httpClient.get(WATCH_URL, {
        params: { v: videoId },
      });
      return response.data;
    } catch (error) {
      throw new VideoUnavailable(videoId);
    }
  }

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
        error instanceof NoTranscriptFound
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
      language: lang.languageName.simpleText,
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
      throw new TranslationLanguageNotAvailable(this.videoId);
    }

    const translatedLanguage = this.translationLanguages.find(
      lang => lang.languageCode === languageCode,
    )!;

    return new TranscriptEntry(
      this.httpClient,
      this.videoId,
      `${this.url}&tlang=${languageCode}`,
      translatedLanguage.language,
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
