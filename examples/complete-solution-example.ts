import { YouTubeTranscriptApi } from '../src';

async function main() {
  try {
    // Create API instance with caching and logging enabled
    const api = new YouTubeTranscriptApi({
      cache: {
        enabled: true,
        maxAge: 86400000, // 24 hour cache to minimize requests
      },
      logger: {
        enabled: true,
        namespace: 'youtube-transcript',
      },
    });

    console.log('Starting transcript fetch...');
    console.log('Attempt flow:');
    console.log('1. Try to fetch directly from YouTube with caching');

    const response = await api.fetchTranscript('dQw4w9WgXcQ');

    console.log('\nSuccess! Fetched transcript for:');
    console.log(`Title: ${response.metadata.title}`);
    console.log(`Author: ${response.metadata.author}`);
    console.log(`Language: ${response.transcript.language}`);
    console.log(`Lines: ${response.transcript.snippets.length}`);
  } catch (error) {
    console.error('Failed to fetch transcript:', error);
    console.error('\nPossible solutions:');
    console.error('1. Verify the video exists and has captions');
    console.error('2. Check your internet connection');
    console.error('3. Try again later if YouTube is rate limiting requests');
  }
}

main().catch(console.error);
