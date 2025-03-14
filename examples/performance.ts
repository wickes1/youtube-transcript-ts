import { YouTubeTranscriptApi } from '../src';

/**
 * Example of using performance logging and caching to optimize transcript fetching
 */
async function performanceExample() {
  try {
    console.log('YouTube Transcript API Performance Testing');
    console.log('=========================================');

    // Create an instance with custom cache settings and logging enabled
    const api = new YouTubeTranscriptApi(
      {
        enabled: true, // Enable caching
        maxAge: 3600000, // Cache for 1 hour (in milliseconds)
      },
      {
        enabled: true, // Enable logging
        namespace: 'youtube-api', // Custom namespace
      },
    );

    // Alternatively, configure logging after creation
    // api.setLoggerOptions({
    //   enabled: true,
    //   namespace: 'custom-prefix'
    // });

    // Example with custom logger
    console.log('\nExample with custom logger:');
    console.log('---------------------------');

    const customLoggerApi = new YouTubeTranscriptApi(
      { enabled: true },
      {
        enabled: true,
        // Custom logger that formats logs differently and includes timestamps
        logger: (type, message, data) => {
          const timestamp = new Date().toISOString();
          console.log(`${timestamp} | ${type.toUpperCase()} | ${message}`);

          if (data) {
            console.log(JSON.stringify(data, null, 2));
          }

          return true; // Prevent default logging
        },
      },
    );

    // List of video IDs to test
    const videoIds = [
      'UF8uR6Z6KLc', // Steve Jobs' Stanford Commencement Speech
      'jNQXAC9IVRw', // Me at the zoo (first YouTube video)
      'aqz-KE-bpKQ', // Big Buck Bunny
    ];

    console.log('\n1. First fetch with performance logging:');
    console.log('---------------------------------------');

    // First fetch with performance logging enabled
    const results1 = await api.fetchTranscript(
      videoIds[0],
      ['en'], // Languages
      false, // Preserve formatting
      undefined, // No formatter
    );

    console.log(`\nFetched transcript for "${results1.metadata.title}" successfully!`);
    console.log(`Transcript length: ${results1.transcript.snippets.length} snippets`);

    console.log('\n2. Second fetch of same video (should use cache):');
    console.log('----------------------------------------------');

    // Second fetch should use cached data
    const results2 = await api.fetchTranscript(
      videoIds[0],
      ['en'], // Languages
      false, // Preserve formatting
      undefined, // No formatter
    );

    console.log(`\nFetched transcript for "${results2.metadata.title}" again successfully!`);
    console.log(`Transcript length: ${results2.transcript.snippets.length} snippets`);

    console.log('\n3. Custom logger example:');
    console.log('------------------------');

    await customLoggerApi.fetchTranscript(
      videoIds[1], // Different video
      ['en'],
      false,
      undefined,
    );

    console.log('\n4. Batch processing with parallelization:');
    console.log('--------------------------------------');

    // Testing batch processing (processes in batches of 3 in parallel)
    console.time('Batch processing');
    const batchResults = await api.fetchTranscripts(videoIds);
    console.timeEnd('Batch processing');

    console.log(`\nSuccessfully fetched ${Object.keys(batchResults.results).length} transcripts`);
    if (Object.keys(batchResults.errors).length > 0) {
      console.log(`Failed to fetch ${Object.keys(batchResults.errors).length} transcripts`);
    }

    // Display results
    for (const [videoId, result] of Object.entries(batchResults.results)) {
      console.log(`- "${result.metadata.title}": ${result.transcript.snippets.length} snippets`);
    }

    console.log('\n5. Clearing cache and refetching:');
    console.log('------------------------------');

    // Clear cache and fetch again
    api.clearCache();
    console.log('Cache cleared');

    console.time('Refetch after cache clear');
    const results3 = await api.fetchTranscript(
      videoIds[0],
      ['en'], // Languages
      false, // Preserve formatting
      undefined, // No formatter
    );
    console.timeEnd('Refetch after cache clear');

    console.log(`\nFetched transcript for "${results3.metadata.title}" without cache!`);

    // Configure cache options
    console.log('\n6. Testing with different cache settings:');
    console.log('-------------------------------------');

    api.setCacheOptions({
      maxAge: 10000, // Set cache to expire after 10 seconds
    });

    console.log('Cache configured to expire after 10 seconds');
    console.log('Waiting 11 seconds...');

    await new Promise(resolve => setTimeout(resolve, 11000));

    console.log('Cache should be expired now, refetching...');

    console.time('Refetch after cache expiration');
    const results4 = await api.fetchTranscript(
      videoIds[0],
      ['en'], // Languages
      false, // Preserve formatting
      undefined, // No formatter
    );
    console.timeEnd('Refetch after cache expiration');

    console.log(`\nFetched transcript for "${results4.metadata.title}" after cache expiration!`);

    // Disable logging
    console.log('\n7. Disabling logging:');
    console.log('-------------------');

    api.setLoggerOptions({ enabled: false });
    console.log('Logging disabled');

    await api.fetchTranscript(videoIds[0], ['en'], false, undefined);

    console.log('Fetch completed with logging disabled (no logs above)');
  } catch (error) {
    console.error('Error:', (error as Error).message);
  }
}

// Run the example
performanceExample().catch(console.error);
