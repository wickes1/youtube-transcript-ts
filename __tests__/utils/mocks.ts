/* eslint-env jest */
/**
 * Mock utilities for testing - this is not a test file
 */

// Mock HTML responses for different scenarios
export const mockHtmlResponses = {
  /* Note: the HTML structure and JSON data must match what the API expects to parse */
  validVideo: `
    <html>
      <head>
        <title>Rick Astley - Never Gonna Give You Up (Official Music Video)</title>
      </head>
      <body>
        <script>
          ytInitialPlayerResponse = {
            "videoDetails": {
              "videoId": "dQw4w9WgXcQ",
              "title": "Rick Astley - Never Gonna Give You Up (Official Music Video)",
              "lengthSeconds": "213",
              "author": "Rick Astley",
              "channelId": "UCuAXFkgsw1L7xaCfnd5JJOw",
              "shortDescription": "Official video for Rick Astley's Never Gonna Give You Up",
              "viewCount": "1234567890",
              "isPrivate": false,
              "isLiveContent": false
            },
            "captions": {
              "playerCaptionsTracklistRenderer": {
                "captionTracks": [
                  {
                    "baseUrl": "https://www.youtube.com/api/timedtext?lang=en&v=dQw4w9WgXcQ",
                    "name": { "simpleText": "English" },
                    "languageCode": "en",
                    "kind": "",
                    "isTranslatable": true
                  },
                  {
                    "baseUrl": "https://www.youtube.com/api/timedtext?lang=es&v=dQw4w9WgXcQ",
                    "name": { "simpleText": "Spanish" },
                    "languageCode": "es",
                    "kind": "",
                    "isTranslatable": true
                  }
                ],
                "translationLanguages": [
                  { "languageCode": "de", "languageName": { "simpleText": "German" } },
                  { "languageCode": "fr", "languageName": { "simpleText": "French" } }
                ]
              }
            },
            "microformat": {
              "playerMicroformatRenderer": {
                "publishDate": "2009-10-25",
                "category": "Music"
              }
            }
          };
        </script>
      </body>
    </html>
  `,
  noTranscripts: `
    <html>
      <head>
        <title>Video without Transcripts</title>
      </head>
      <body>
        <script>
          ytInitialPlayerResponse = {
            videoDetails: {
              videoId: 'no-transcripts',
              title: 'Video without Transcripts',
              lengthSeconds: '120',
              author: 'Test Channel',
              viewCount: '1000'
            },
            // No captions field
          };
        </script>
      </body>
    </html>
  `,
  unavailableVideo: `
    <html>
      <head>
        <title>Video Unavailable</title>
      </head>
      <body>
        <div id="player-unavailable">
          <h1>This video is unavailable</h1>
        </div>
      </body>
    </html>
  `,
  ipBlocked: `
    <html>
      <head>
        <title>IP Blocked</title>
      </head>
      <body>
        <div id="error-screen">
          <div id="creator-editor-templates"></div>
          <div id="unavailable-submessage">This video is not available in your country.</div>
        </div>
      </body>
    </html>
  `,
};

// Mock transcript XML responses
export const mockTranscriptResponses = {
  english: `<?xml version="1.0" encoding="utf-8" ?>
    <transcript>
      <text start="0" dur="4.5">Never gonna give you up</text>
      <text start="4.5" dur="3.5">Never gonna let you down</text>
      <text start="8" dur="4">Never gonna run around and desert you</text>
    </transcript>
  `,
  spanish: `<?xml version="1.0" encoding="utf-8" ?>
    <transcript>
      <text start="0" dur="4.5">¡Español! Nunca te voy a abandonar</text>
      <text start="4.5" dur="3.5">Nunca te voy a defraudar</text>
      <text start="8" dur="4">Nunca voy a correr y abandonarte</text>
    </transcript>
  `,
  formatted: `<?xml version="1.0" encoding="utf-8" ?>
    <transcript>
      <text start="0" dur="4.5">Never gonna <i>give</i> you up</text>
      <text start="4.5" dur="3.5">Never gonna <b>let</b> you down</text>
      <text start="8" dur="4">Never gonna <u>run</u> around and desert you</text>
    </transcript>
  `,
};

// Mock implementation for axios
export const mockAxios = {
  create: jest.fn().mockReturnValue({
    get: jest.fn().mockImplementation((url: string, config: any) => {
      // Handle watch URL (HTML requests)
      if (url === 'https://www.youtube.com/watch') {
        const videoId = config?.params?.v;

        if (videoId === 'dQw4w9WgXcQ') {
          return Promise.resolve({ data: mockHtmlResponses.validVideo });
        }
        if (videoId === 'no-transcripts') {
          return Promise.resolve({ data: mockHtmlResponses.noTranscripts });
        }
        if (videoId === 'unavailable') {
          return Promise.resolve({ data: mockHtmlResponses.unavailableVideo });
        }
        if (videoId === 'ip-blocked') {
          return Promise.resolve({ data: mockHtmlResponses.ipBlocked });
        }
      }

      // Handle transcript URL requests
      if (url.includes('api/timedtext')) {
        if (url.includes('lang=en')) {
          return Promise.resolve({ data: mockTranscriptResponses.english });
        }
        if (url.includes('lang=es')) {
          return Promise.resolve({ data: mockTranscriptResponses.spanish });
        }
        if (url.includes('fmt=srv3')) {
          return Promise.resolve({ data: mockTranscriptResponses.formatted });
        }
      }

      console.warn(`Unexpected URL in tests: ${url}`, config);
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }),
    defaults: {
      headers: {
        common: {},
      },
    },
  }),
};

/**
 * Create a testing environment with mocked dependencies
 */
export function createTestEnvironment() {
  // Mock console.log
  const originalConsoleLog = console.log;
  const mockConsoleLog = jest.fn();
  console.log = mockConsoleLog;

  // Mock console.error
  const originalConsoleError = console.error;
  const mockConsoleError = jest.fn();
  console.error = mockConsoleError;

  // Setup axios mock
  const axios = require('axios');
  axios.default.create = mockAxios.create;

  return {
    mockAxios,
    mockConsoleLog,
    mockConsoleError,
    cleanup: () => {
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
    },
  };
}

/**
 * Cleanup mocks after testing
 */
export function cleanupMocks() {
  const { cleanup } = createTestEnvironment();
  cleanup();
}
