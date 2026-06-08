/* eslint-env jest */
/**
 * Direct unit tests for the exported TranscriptEntry: the content-fetch error mapping
 * (a 5xx must surface as the retryable RequestFailed, not a blanket VideoUnavailable) and
 * the translate() chain (NotTranslatable / TranslationLanguageNotAvailable / tlang URL build).
 *
 * TranscriptEntry takes an AxiosInstance in its constructor, so we hand it a tiny stub
 * client and drive its public methods without the full fetchTranscript stack.
 */
import {
  TranscriptEntry,
  RequestFailed,
  VideoUnavailable,
  IpBlocked,
  NotTranslatable,
  TranslationLanguageNotAvailable,
  type TranslationLanguage,
} from '../src';
import type { AxiosInstance } from 'axios';

jest.mock('axios');

interface AxiosLikeError extends Error {
  isAxiosError: boolean;
  code?: string;
  response?: { status: number };
}

function axiosError(opts: { status?: number; code?: string }): AxiosLikeError {
  const err = new Error('boom') as AxiosLikeError;
  err.isAxiosError = true;
  if (opts.status !== undefined) err.response = { status: opts.status };
  if (opts.code !== undefined) err.code = opts.code;
  return err;
}

beforeAll(() => {
  // Wire axios.isAxiosError so TranscriptEntry.fetch()'s error-mapping branch is reachable.
  const axios = require('axios');
  const isAxiosError = (p: unknown): boolean => (p as AxiosLikeError)?.isAxiosError === true;
  axios.isAxiosError = isAxiosError;
  axios.default.isAxiosError = isAxiosError;
});

const VALID_XML =
  '<?xml version="1.0"?><transcript><text start="0" dur="2.5">Hello &amp; welcome</text></transcript>';

/** Build a stub AxiosInstance whose get() resolves/rejects per the provided implementation. */
function stubClient(get: jest.Mock): AxiosInstance {
  return { get } as unknown as AxiosInstance;
}

function makeEntry(client: AxiosInstance, translationLanguages: TranslationLanguage[] = []) {
  return new TranscriptEntry(
    client,
    'vid123',
    'https://www.youtube.com/api/timedtext?lang=en&v=vid123',
    'English',
    'en',
    false,
    translationLanguages,
  );
}

describe('TranscriptEntry.fetch error mapping', () => {
  it('parses XML and decodes entities on success', async () => {
    const entry = makeEntry(
      stubClient(jest.fn().mockResolvedValue({ status: 200, data: VALID_XML })),
    );
    const transcript = await entry.fetch();
    expect(transcript.snippets).toHaveLength(1);
    expect(transcript.snippets[0].text).toBe('Hello & welcome');
    expect(transcript.snippets[0].start).toBe(0);
    expect(transcript.snippets[0].duration).toBeCloseTo(2.5, 3);
  });

  it('maps a 5xx content fetch to retryable RequestFailed (not VideoUnavailable)', async () => {
    const entry = makeEntry(stubClient(jest.fn().mockRejectedValue(axiosError({ status: 503 }))));
    await expect(entry.fetch()).rejects.toBeInstanceOf(RequestFailed);
  });

  it('maps a timeout (ECONNABORTED) content fetch to retryable RequestFailed', async () => {
    const entry = makeEntry(
      stubClient(jest.fn().mockRejectedValue(axiosError({ code: 'ECONNABORTED' }))),
    );
    const err = (await entry.fetch().catch((e: unknown) => e)) as RequestFailed;
    expect(err).toBeInstanceOf(RequestFailed);
    expect(err.retryable).toBe(true);
  });

  it('maps a 403 content fetch to IpBlocked', async () => {
    const entry = makeEntry(stubClient(jest.fn().mockRejectedValue(axiosError({ status: 403 }))));
    await expect(entry.fetch()).rejects.toBeInstanceOf(IpBlocked);
  });

  it('maps a 404 content fetch to VideoUnavailable', async () => {
    const entry = makeEntry(stubClient(jest.fn().mockRejectedValue(axiosError({ status: 404 }))));
    await expect(entry.fetch()).rejects.toBeInstanceOf(VideoUnavailable);
  });
});

describe('TranscriptEntry.translate', () => {
  const translatable: TranslationLanguage[] = [
    { languageCode: 'de', languageName: 'German' },
    { languageCode: 'fr', languageName: 'French' },
  ];

  it('throws NotTranslatable when the entry has no translation languages', async () => {
    const entry = makeEntry(stubClient(jest.fn()), []);
    await expect(entry.translate('de')).rejects.toBeInstanceOf(NotTranslatable);
  });

  it('throws TranslationLanguageNotAvailable for an unsupported target language', async () => {
    const entry = makeEntry(stubClient(jest.fn()), translatable);
    await expect(entry.translate('zz')).rejects.toBeInstanceOf(TranslationLanguageNotAvailable);
  });

  it('returns a translated entry whose URL carries the tlang query parameter', async () => {
    const get = jest.fn().mockResolvedValue({ status: 200, data: VALID_XML });
    const entry = makeEntry(stubClient(get), translatable);

    const translated = await entry.translate('de');
    expect(translated).toBeInstanceOf(TranscriptEntry);

    // The translated entry should fetch from a URL bearing tlang=de.
    await translated.fetch();
    expect(get).toHaveBeenCalledWith(expect.stringContaining('tlang=de'));
  });
});
