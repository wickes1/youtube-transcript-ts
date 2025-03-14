// Import from the main package entry point - proper usage
import { YouTubeTranscriptApi } from '..';

// Example 1: Basic usage
async function example1() {
  try {
    const api = new YouTubeTranscriptApi();

    // Example video (Rick Astley - Never Gonna Give You Up)
    const videoId = 'dQw4w9WgXcQ';

    const response = await api.fetchTranscript(videoId);

    console.log(`Found transcript with ${response.transcript.snippets.length} lines`);
    console.log(`First few lines:`);

    response.transcript.snippets.slice(0, 3).forEach(snippet => {
      console.log(`[${snippet.start.toFixed(1)}s]: ${snippet.text}`);
    });
  } catch (error) {
    console.error('Error:', error);
  }
}

// Example 2: With metadata and formatting
async function example2() {
  try {
    const api = new YouTubeTranscriptApi();

    // Example video (Rick Astley - Never Gonna Give You Up)
    const videoId = 'dQw4w9WgXcQ';

    // Get transcript with formatted text
    const response = await api.fetchTranscript(videoId, ['en'], false, 'json');

    // Access metadata (always included)
    console.log(`Video title: ${response.metadata.title}`);
    console.log(`Channel: ${response.metadata.author}`);

    // Access the formatted text (only included when formatter is specified)
    if (response.formattedText) {
      console.log('Formatted transcript (JSON):');
      console.log(response.formattedText.substring(0, 100) + '...');
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the examples
(async () => {
  console.log('=== Example 1: Basic Usage ===');
  await example1();

  console.log('\n=== Example 2: With Metadata and Formatting ===');
  await example2();
})();
