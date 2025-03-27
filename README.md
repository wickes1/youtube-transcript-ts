# YouTube Transcript API (TypeScript)

A TypeScript library to retrieve transcripts/subtitles from YouTube videos. Supports auto-generated subtitles, multiple languages, and formatting options.

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

```typescript
import { YouTubeTranscriptApi } from 'youtube-transcript-ts';

// Create API instance with default configuration
const api = new YouTubeTranscriptApi();

// Get transcript using video ID or URL
const response = await api.fetchTranscript('dQw4w9WgXcQ');
// or: await api.fetchTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

// Access transcript data
console.log(`Found ${response.transcript.snippets.length} lines`);
response.transcript.snippets.slice(0, 3).forEach(snippet => {
  console.log(`[${snippet.start.toFixed(1)}s]: ${snippet.text}`);
});

// Access video metadata (always included)
console.log(`Title: ${response.metadata.title}`);
console.log(`Author: ${response.metadata.author}`);
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

// Multiple fallback instances for improved reliability
const apiWithFallbacks = new YouTubeTranscriptApi({
  invidious: {
    enabled: true,
    instanceUrls: ['https://yewtu.be'],
    timeout: 8000, // custom timeout in ms
  },
});

// Configure Invidious after initialization
const api = new YouTubeTranscriptApi();
api.setInvidiousOptions({
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
const api = new YouTubeTranscriptApi();
api.setProxyOptions({
  enabled: true,
  http: 'http://username:password@http-proxy.com:8080',
  https: 'http://username:password@https-proxy.com:8443',
});

// Disable proxy
api.setProxyOptions({
  enabled: false,
});
```

### Language Selection

```typescript
// Get transcript in German, fallback to English
const response = await api.fetchTranscript('VIDEO_ID', ['de', 'en']);
console.log(`Language: ${response.transcript.language}`);
```

### Formatting Options

```typescript
// Available formats: 'text', 'json', 'srt', 'webvtt'
const textResponse = await api.fetchTranscript('VIDEO_ID', ['en'], false, 'text');
console.log(textResponse.formattedText); // Plain text string
```

### Cookie Authentication for Age-Restricted Videos

```typescript
// Set cookies for age-restricted videos
api.setCookies({
  CONSENT: 'YES+cb',
  VISITOR_INFO1_LIVE: 'your_visitor_info',
});
```

## Error Handling

The API throws specific error types for different failure cases:

```typescript
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
