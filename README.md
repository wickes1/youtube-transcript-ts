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

### Batch Processing

```typescript
const { results, errors } = await api.fetchTranscripts(
  ['VIDEO_ID_1', 'VIDEO_ID_2', 'https://www.youtube.com/watch?v=VIDEO_ID_3'],
  {
    languages: ['en', 'de'],
    formatter: 'json',
    stopOnError: false,
  },
);
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
api.setCookies({
  CONSENT: 'YES+cb',
  LOGIN_INFO: 'your_login_cookie',
});
const response = await api.fetchTranscript('AGE_RESTRICTED_VIDEO_ID');
```

### Performance Optimization

```typescript
// Custom cache settings
const api = new YouTubeTranscriptApi({
  enabled: true,
  maxAge: 3600000, // 1 hour in milliseconds
});

// Enable logging
api.setLoggerOptions({
  enabled: true,
  namespace: 'custom-prefix',
});
```

## Response Format

```typescript
interface TranscriptResponse {
  transcript: {
    snippets: Array<{ text: string; start: number; duration: number }>;
    videoId: string;
    language: string;
    languageCode: string;
    isGenerated: boolean;
  };
  metadata: {
    id: string;
    title: string;
    author: string;
    // other video metadata
  };
  formattedText?: string; // Only when formatter is specified
}
```

## How It Works

This library fetches the YouTube video page, extracts caption track information, requests the transcript in XML format, and parses the data. No API key required.

## Limitations

- **Rate Limiting**: YouTube may rate-limit excessive requests
- **Authentication**: Required for private or age-restricted videos
- **Availability**: Not all videos have transcripts or specific languages
- **YouTube API Changes**: Uses unofficial endpoints that may change
- **IP Blocking**: Possible with high-volume requests

## Module Format

Distributed as ES module (ESM) compatible with:
- Node.js (v12.20+, v14.14+, v16.0+)
- Modern browsers
- Bundlers (webpack, Rollup, Vite)

## Acknowledgements

Inspired by the Python [YouTube Transcript API](https://github.com/jdepoix/youtube-transcript-api) by [@jdepoix](https://github.com/jdepoix), rebuilt in TypeScript with additional features.
