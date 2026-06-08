# YouTube Transcript API (TypeScript)

A TypeScript library to retrieve transcripts/subtitles from YouTube videos. Supports auto-generated subtitles, multiple languages, and formatting options.

## Requirements

| Requirement    | Value                         |
| -------------- | ----------------------------- |
| Node           | >= 18                         |
| Module systems | ESM and CommonJS (dual build) |
| Types          | Bundled (`.d.ts`)             |

The package ships both an ESM (`import`) and a CJS (`require`) entry point from a single install. TypeScript types are included.

## Installation

```bash
# pnpm
pnpm add youtube-transcript-ts

# npm
npm install youtube-transcript-ts

# yarn
yarn add youtube-transcript-ts
```

## Quick Start

ESM (`import`):

```typescript
import { YouTubeTranscriptApi } from 'youtube-transcript-ts';

const api = new YouTubeTranscriptApi();

// Pass a video ID or a full YouTube URL.
const response = await api.fetchTranscript('dQw4w9WgXcQ');
// or: await api.fetchTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

// Transcript data
console.log(`Found ${response.transcript.snippets.length} lines`);
response.transcript.snippets.slice(0, 3).forEach(snippet => {
  console.log(`[${snippet.start.toFixed(1)}s]: ${snippet.text}`);
});

// Video metadata (always included)
console.log(`Title: ${response.metadata.title}`);
console.log(`Author: ${response.metadata.author}`);
```

CommonJS (`require`):

```javascript
const { YouTubeTranscriptApi } = require('youtube-transcript-ts');

const api = new YouTubeTranscriptApi();
const response = await api.fetchTranscript('dQw4w9WgXcQ');
```

## Features

### API Configuration

```typescript
// Initialize with a comprehensive configuration
const api = new YouTubeTranscriptApi({
  // Cache settings
  cache: {
    enabled: true,
    maxAge: 3600000, // 1 hour in milliseconds
  },
  // Logging settings
  logger: {
    enabled: true,
    namespace: 'transcript-api',
  },
  // Invidious settings
  invidious: {
    enabled: false, // disabled by default
    instanceUrls: 'https://yewtu.be',
    timeout: 10000, // 10 seconds
  },
  // Proxy settings
  proxy: {
    enabled: false, // disabled by default
    http: 'http://localhost:8080',
    https: 'http://localhost:8080',
  },
});
```

### Invidious Proxy Support

Invidious proxy support allows you to fetch transcripts even when YouTube API access is restricted or blocked. This feature is particularly useful for:

- Bypassing IP blocks or regional restrictions
- Accessing transcripts without YouTube tracking
- Improving reliability when YouTube API changes

```typescript
// Setup with Invidious fallback
const api = new YouTubeTranscriptApi({
  invidious: {
    enabled: true,
    instanceUrls: 'https://yewtu.be', // Use a single instance
  },
});

// Multiple fallback instances for improved reliability.
// Failover requires more than one distinct host — the list is tried in order.
const apiWithFallbacks = new YouTubeTranscriptApi({
  invidious: {
    enabled: true,
    instanceUrls: ['https://yewtu.be', 'https://invidious.example.org'],
    timeout: 8000, // custom timeout in ms
  },
});

// Configure Invidious after initialization
const apiLater = new YouTubeTranscriptApi();
apiLater.setInvidiousOptions({
  enabled: true,
  instanceUrls: 'https://yewtu.be',
});
```

> **Note for self-hosting Invidious**: If you're running your own Invidious instance for transcript fetching, you must set `use_innertube_for_captions: true` in your Invidious configuration file for transcript functionality to work properly.

### HTTP/HTTPS Proxy Support

You can configure the library to use HTTP and HTTPS proxies for all outgoing requests. This is useful in environments where direct connections to YouTube are restricted or when you need to route traffic through specific proxy servers.

```typescript
// Initialize with proxy configuration
const api = new YouTubeTranscriptApi({
  proxy: {
    enabled: true,
    http: 'http://http-proxy-server.com:8080',
    https: 'http://https-proxy-server.com:8443',
  },
});

// When both HTTP and HTTPS use the same proxy
const apiWithSameProxy = new YouTubeTranscriptApi({
  proxy: {
    enabled: true,
    http: 'http://proxy-server.com:8080',
    https: 'http://proxy-server.com:8080',
  },
});

// Configure proxy after initialization
const apiLater = new YouTubeTranscriptApi();
apiLater.setProxyOptions({
  enabled: true,
  http: 'http://username:password@http-proxy.com:8080',
  https: 'http://username:password@https-proxy.com:8443',
});

// Disable proxy
apiLater.setProxyOptions({
  enabled: false,
});
```

### Language Selection

```typescript
// Get transcript in German, fallback to English
const response = await api.fetchTranscript('VIDEO_ID', { languages: ['de', 'en'] });
console.log(`Language: ${response.transcript.language}`);
```

### Formatting Options

`fetchTranscript` takes an options object: `{ languages?, preserveFormatting?, formatter? }`. Available formats: `text`, `json`, `srt`, `webvtt`.

```typescript
const textResponse = await api.fetchTranscript('VIDEO_ID', {
  languages: ['en'],
  formatter: 'text',
});
console.log(textResponse.formattedText); // Plain text string
```

> The positional form `fetchTranscript(id, languages, preserveFormatting, formatter)` is deprecated (boolean trap) and may be removed in a future major. Prefer the options object.

### Cookie Authentication for Age-Restricted Videos

```typescript
// Set cookies for age-restricted videos
api.setCookies({
  CONSENT: 'YES+cb',
  VISITOR_INFO1_LIVE: 'your_visitor_info',
});
```

## Error Handling

The API throws specific error types for different failure cases. Import the ones you check against:

```typescript
import {
  YouTubeTranscriptApi,
  VideoUnavailable,
  NoTranscriptFound,
  TranscriptsDisabled,
  IpBlocked,
} from 'youtube-transcript-ts';

const api = new YouTubeTranscriptApi();

try {
  const transcript = await api.fetchTranscript('VIDEO_ID');
} catch (error) {
  if (error instanceof VideoUnavailable) {
    console.error('Video is not available');
  } else if (error instanceof NoTranscriptFound) {
    console.error('No transcript found for the requested languages');
  } else if (error instanceof TranscriptsDisabled) {
    console.error('Transcripts are disabled for this video');
  } else if (error instanceof IpBlocked) {
    console.error('Your IP address is blocked by YouTube');
  } else {
    console.error('An unexpected error occurred:', error);
  }
}
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details
