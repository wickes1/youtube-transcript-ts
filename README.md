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
});
```

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
  } else {
    console.error('An unexpected error occurred:', error);
  }
}
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details
