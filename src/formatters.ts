import { Transcript, TranscriptSnippet } from './types';

export abstract class Formatter {
  abstract format(transcript: Transcript): string;

  /**
   * Format multiple transcripts
   * @param transcripts Array of transcripts to format
   * @returns Formatted string containing all transcripts
   */
  formatTranscripts(transcripts: Transcript[]): string {
    // Default implementation concatenates individual formats
    return transcripts.map(t => this.format(t)).join('\n\n\n');
  }
}

export class JSONFormatter extends Formatter {
  format(transcript: Transcript): string {
    return JSON.stringify(transcript, null, 2);
  }

  /**
   * Format multiple transcripts as a JSON array
   */
  override formatTranscripts(transcripts: Transcript[]): string {
    return JSON.stringify(transcripts, null, 2);
  }
}

export class TextFormatter extends Formatter {
  format(transcript: Transcript): string {
    return transcript.snippets.map(line => line.text).join('\n');
  }
}

abstract class TextBasedFormatter extends TextFormatter {
  protected abstract formatTimestamp(hours: number, mins: number, secs: number, ms: number): string;
  protected abstract formatTranscriptHeader(lines: string[]): string;
  protected abstract formatTranscriptLine(
    index: number,
    timeText: string,
    snippet: TranscriptSnippet,
  ): string;

  protected secondsToTimestamp(time: number): string {
    const [hours, remainder] = this.divmod(time, 3600);
    const [mins, secs] = this.divmod(remainder, 60);
    const ms = Math.round((time - Math.floor(time)) * 1000);

    return this.formatTimestamp(Math.floor(hours), Math.floor(mins), Math.floor(secs), ms);
  }

  private divmod(n: number, d: number): [number, number] {
    return [Math.floor(n / d), n % d];
  }

  format(transcript: Transcript): string {
    const lines = transcript.snippets.map((line, i) => {
      const end = line.start + line.duration;
      const nextStart = i < transcript.snippets.length - 1 ? transcript.snippets[i + 1].start : end;
      const timeText = `${this.secondsToTimestamp(line.start)} --> ${this.secondsToTimestamp(
        nextStart < end ? nextStart : end,
      )}`;
      return this.formatTranscriptLine(i, timeText, line);
    });

    return this.formatTranscriptHeader(lines);
  }

  /**
   * Format multiple transcripts with separator
   */
  override formatTranscripts(transcripts: Transcript[]): string {
    return transcripts
      .map((transcript, i) => {
        const header = `TRANSCRIPT ${i + 1}:`;
        return `${header}\n${this.format(transcript)}`;
      })
      .join('\n\n');
  }
}

export class SRTFormatter extends TextBasedFormatter {
  protected formatTimestamp(hours: number, mins: number, secs: number, ms: number): string {
    return `${this.pad(hours)}:${this.pad(mins)}:${this.pad(secs)},${this.pad(ms, 3)}`;
  }

  protected formatTranscriptHeader(lines: string[]): string {
    return lines.join('\n\n') + '\n';
  }

  protected formatTranscriptLine(
    index: number,
    timeText: string,
    snippet: TranscriptSnippet,
  ): string {
    return `${index + 1}\n${timeText}\n${snippet.text}`;
  }

  private pad(num: number, width: number = 2): string {
    return num.toString().padStart(width, '0');
  }
}

export class WebVTTFormatter extends TextBasedFormatter {
  protected formatTimestamp(hours: number, mins: number, secs: number, ms: number): string {
    return `${this.pad(hours)}:${this.pad(mins)}:${this.pad(secs)}.${this.pad(ms, 3)}`;
  }

  protected formatTranscriptHeader(lines: string[]): string {
    return `WEBVTT\n\n${lines.join('\n\n')}\n`;
  }

  protected formatTranscriptLine(
    index: number,
    timeText: string,
    snippet: TranscriptSnippet,
  ): string {
    return `${timeText}\n${snippet.text}`;
  }

  private pad(num: number, width: number = 2): string {
    return num.toString().padStart(width, '0');
  }
}

export type FormatterType = 'json' | 'text' | 'srt' | 'webvtt';

export class FormatterFactory {
  static readonly TYPES = {
    json: JSONFormatter,
    text: TextFormatter,
    srt: SRTFormatter,
    webvtt: WebVTTFormatter,
  } as const;

  static create(type: FormatterType = 'json'): Formatter {
    const FormatterClass = FormatterFactory.TYPES[type];
    if (!FormatterClass) {
      throw new Error(
        `The format '${type}' is not supported. Choose one of the following formats: ${Object.keys(
          FormatterFactory.TYPES,
        ).join(', ')}`,
      );
    }
    return new FormatterClass();
  }
}
