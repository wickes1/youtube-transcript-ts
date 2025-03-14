# YouTube Transcript API (TypeScript)

A TypeScript implementation of the YouTube Transcript API that allows you to get the transcripts/subtitles for a given YouTube video. It also works for automatically generated subtitles and supports translating subtitles.

## Table of Contents

- [How It Works](#how-it-works)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage](#usage)
  - [Batch Processing](#batch-processing)
  - [Video Metadata](#video-metadata)
  - [Cookie Authentication](#cookie-authentication-for-age-restricted-videos)
  - [Getting Transcripts for Specific Languages](#getting-transcripts-for-specific-languages)
  - [Formatting Options](#formatting-options)
  - [Format Multiple Transcripts](#format-multiple-transcripts)
- [Limitations](#limitations)
- [Acknowledgements](#acknowledgements)

## How It Works

This library works by:

1. Fetching the YouTube video page
2. Extracting the captions track information from the page data
3. Requesting the transcript in XML format from YouTube's servers
4. Parsing and formatting the transcript data
5. Providing additional features like caching, metadata extraction, and transcript formatting

No API key is required, as it uses the same public endpoints that YouTube's player uses to fetch captions.

## Installation

```bash
# npm
npm install youtube-transcript-ts

# yarn
yarn add youtube-transcript-ts

# pnpm
pnpm add youtube-transcript-ts
```

## Quick Start

```typescript
// Import with named import (recommended)
import { YouTubeTranscriptApi } from 'youtube-transcript-ts';

// Or import as default
import YouTubeTranscriptApi from 'youtube-transcript-ts';

// Create an instance of the API
const api = new YouTubeTranscriptApi();

// Get transcript for a video (using video ID or URL)
const response = await api.fetchTranscript('dQw4w9WgXcQ'); // Rick Astley - Never Gonna Give You Up
// You can also use a full YouTube URL:
// await api.fetchTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

// Access transcript data
console.log(`Found transcript with ${response.transcript.snippets.length} lines`);
response.transcript.snippets.slice(0, 3).forEach(snippet => {
  console.log(`[${snippet.start.toFixed(1)}s]: ${snippet.text}`);
});

// Access video metadata (always included)
console.log(`Title: ${response.metadata.title}`);
console.log(`Author: ${response.metadata.author}`);
```

> **Note:** When using in a Node.js environment, make sure your package.json has `"type": "module"` or use the `.mjs` extension for your files.

For complete examples, check the [examples directory](examples/) in the source code.

## Usage

### Batch Processing

```typescript
// Import the API
import { YouTubeTranscriptApi } from 'youtube-transcript-ts';

const api = new YouTubeTranscriptApi();

// Fetch transcripts for multiple videos at once
const { results, errors } = await api.fetchTranscripts(
  ['VIDEO_ID_1', 'VIDEO_ID_2', 'https://www.youtube.com/watch?v=VIDEO_ID_3'],
  {
    languages: ['en', 'de'],
    preserveFormatting: false,
    formatter: 'json',
    stopOnError: false, // Set to true to stop on first error
  },
);

// Access successful transcripts
console.log(`Found ${Object.keys(results).length} transcripts`);
for (const [videoId, response] of Object.entries(results)) {
  console.log(`Transcript for ${videoId}:`);
  console.log(`- Language: ${response.transcript.language}`);
  console.log(`- Lines: ${response.transcript.snippets.length}`);

  // Access metadata (always included)
  console.log(`- Title: ${response.metadata.title}`);

  // Access formatted text if requested
  if (response.formattedText) {
    console.log(`- Formatted preview: ${response.formattedText.substring(0, 50)}...`);
  }
}

// Check for errors
if (Object.keys(errors).length > 0) {
  console.log(`Failed to fetch ${Object.keys(errors).length} transcripts`);
  for (const [videoId, error] of Object.entries(errors)) {
    console.error(`Error for ${videoId}: ${error.message}`);
  }
}
```

### Video Metadata

```typescript
import { YouTubeTranscriptApi } from 'youtube-transcript-ts';

const api = new YouTubeTranscriptApi();

// All transcript responses include metadata
const response = await api.fetchTranscript('VIDEO_ID');

// Access video metadata
console.log(`Title: ${response.metadata.title}`);
console.log(`Author: ${response.metadata.author}`);
console.log(`Duration: ${response.metadata.lengthSeconds} seconds`);
console.log(`First line: ${response.transcript.snippets[0].text}`);
```

### Cookie Authentication for Age-Restricted Videos

```typescript
import { YouTubeTranscriptApi } from 'youtube-transcript-ts';

const api = new YouTubeTranscriptApi();

// Set authentication cookies
api.setCookies({
  CONSENT: 'YES+cb',
  LOGIN_INFO: 'your_login_cookie',
  // Add any other required cookies
});

// Now you can access age-restricted videos
const response = await api.fetchTranscript('AGE_RESTRICTED_VIDEO_ID');
```

### Getting Transcripts for Specific Languages

```typescript
import { YouTubeTranscriptApi } from 'youtube-transcript-ts';

const api = new YouTubeTranscriptApi();

// Get transcript in German, fallback to English if German not available
const response = await api.fetchTranscript('VIDEO_ID', ['de', 'en']);
console.log(`Found transcript in language: ${response.transcript.language}`);
```

### Formatting Options

```typescript
import { YouTubeTranscriptApi } from 'youtube-transcript-ts';

const api = new YouTubeTranscriptApi();

// Get transcript as plain text
const textResponse = await api.fetchTranscript('VIDEO_ID', ['en'], false, 'text');
console.log(textResponse.formattedText); // Plain text string

// Get transcript as JSON string
const jsonResponse = await api.fetchTranscript('VIDEO_ID', ['en'], false, 'json');
console.log(jsonResponse.formattedText); // JSON string
console.log(JSON.parse(jsonResponse.formattedText)); // Convert back to object if needed

// Get transcript in SRT format (for subtitles)
const srtResponse = await api.fetchTranscript('VIDEO_ID', ['en'], false, 'srt');
console.log(srtResponse.formattedText);
```

### Format Multiple Transcripts

```typescript
import { YouTubeTranscriptApi, FormatterFactory } from 'youtube-transcript-ts';

const api = new YouTubeTranscriptApi();

// Get multiple transcripts and format them together
const { results } = await api.fetchTranscripts(['VIDEO_ID_1', 'VIDEO_ID_2'], {
  formatter: 'text',
});

// Or manually format multiple transcripts
const transcripts = [
  (await api.fetchTranscript('VIDEO_ID_1')).transcript,
  (await api.fetchTranscript('VIDEO_ID_2')).transcript,
];

const formatter = FormatterFactory.create('json');
const formattedJson = formatter.formatTranscripts(transcripts);
console.log(formattedJson); // JSON array of transcripts
```

### Response Format

The `fetchTranscript` method always returns a standardized `TranscriptResponse` object with the following structure:

```typescript
interface TranscriptResponse {
  // The transcript data
  transcript: {
    snippets: Array<{ text: string; start: number; duration: number }>;
    videoId: string;
    language: string;
    languageCode: string;
    isGenerated: boolean;
  };

  // Video metadata (always included)
  metadata: {
    id: string;
    title: string;
    author: string;
    // ...other video metadata
  };

  // Only included when formatter is specified
  formattedText?: string;
}
```

This consistent structure means you can always access properties in the same way, regardless of which options you use when calling `fetchTranscript`.

## API Reference

### The YouTubeTranscriptApi Class

#### Constructor

```typescript
constructor(
  cacheOptions?: Partial<CacheOptions>,
  loggerOptions?: Partial<LoggerOptions>
)
```

Creates a new instance of the YouTubeTranscriptApi with optional settings.

- `cacheOptions` - Optional cache configuration:
  - `enabled`: Boolean to enable/disable caching (default: true)
  - `maxAge`: Cache lifetime in milliseconds (default: 3600000 - 1 hour)
- `loggerOptions` - Optional logging configuration:
  - `enabled`: Boolean to enable/disable logging (default: false)
  - `namespace`: Prefix for log messages (default: 'youtube-transcript')
  - `logger`: Custom logger function

#### Methods

##### fetchTranscript

```typescript
async fetchTranscript(
  videoIdOrUrl: string,
  languages: string[] = ['en'],
  preserveFormatting: boolean = false,
  formatter?: 'json' | 'text' | 'srt' | 'webvtt'
): Promise<TranscriptResponse>
```

Fetches the transcript for a single video.

- `videoIdOrUrl` - YouTube video ID or URL
- `languages` - List of language codes to search for (in order of preference)
- `preserveFormatting` - Whether to keep select HTML text formatting
- `formatter` - Optional formatter to convert the transcript to different formats (json, text, srt, webvtt)

Returns a `TranscriptResponse` object containing:

- `transcript` - The transcript data
- `metadata` - Video metadata (always included)
- `formattedText` - Formatted text if a formatter was specified

## Performance Optimization

The library includes built-in performance optimization features to improve speed and reduce network usage.

### Caching

The API automatically caches HTML content and transcript data to avoid redundant network requests.

```typescript
import { YouTubeTranscriptApi } from 'youtube-transcript-ts';

// Create API with custom cache settings
const api = new YouTubeTranscriptApi({
  enabled: true, // Enable caching (default)
  maxAge: 3600000, // Cache lifetime in milliseconds (default: 1 hour)
});

// Configure cache after creation
api.setCacheOptions({
  maxAge: 600000, // Set cache to expire after 10 minutes
});

// Clear cache when needed
api.clearCache(); // Clear all cache
api.clearCache('html'); // Clear only HTML cache
api.clearCache('transcript'); // Clear only transcript cache
```

### Logging System

The library provides a configurable logging system that can be integrated with your application's logging:

```typescript
import { YouTubeTranscriptApi } from 'youtube-transcript-ts';

// Create API with logging enabled
const api = new YouTubeTranscriptApi(
  { enabled: true }, // Cache options
  {
    enabled: true, // Enable logging
    namespace: 'youtube-transcript', // Custom namespace prefix (default)
  },
);

// Or configure logging after creation
api.setLoggerOptions({
  enabled: true,
  namespace: 'custom-prefix',
});

// Use custom logger function to integrate with your logging system
api.setLoggerOptions({
  enabled: true,
  logger: (type, message, data) => {
    // Write to your own logging system
    myLogger.log(`[${type}] ${message}`, data);
    return true; // Return true to prevent default console.log
  },
});

// Logs will include these types:
// - performance: Timing information for operations
// - info: General information
// - error: Error information
```

## Module Format

This package is distributed as an ES module (ESM) and works in modern environments that support ESM including:

- Node.js (v12.20+, v14.14+, or v16.0+)
- Modern browsers
- Bundlers (webpack, Rollup, Vite, etc.)

When using in Node.js:

- Use `import` syntax instead of `require()`
- In CommonJS projects, you can:
  - Add `"type": "module"` to your package.json
  - Use dynamic imports: `const { YouTubeTranscriptApi } = await import('youtube-transcript-ts')`
  - Use the `.mjs` extension for your files

## Limitations

When using this library, be aware of these limitations:

- **Rate Limiting**: YouTube may rate-limit your requests if you make too many in a short period. Consider implementing retry logic and rate limiting in your application.
- **Private Videos**: The API cannot access transcripts for private videos.
- **Age-Restricted Videos**: These require authentication with cookies as described in the documentation.
- **Changing YouTube API**: This library uses unofficial YouTube API endpoints which may change without notice. If something stops working, please report an issue.
- **IP Blocking**: YouTube may temporarily block IPs that make too many requests. Consider using rotating proxies for high-volume applications.
- **No Guarantee of Transcript Availability**: Not all videos have transcripts, especially newer or less popular content.
- **Language Availability**: Some videos only have transcripts in specific languages.

## Acknowledgements

This project is inspired by the Python [YouTube Transcript API](https://github.com/jdepoix/youtube-transcript-api) by [@jdepoix](https://github.com/jdepoix), reimagined and rebuilt from the ground up in TypeScript with additional features and improvements.
