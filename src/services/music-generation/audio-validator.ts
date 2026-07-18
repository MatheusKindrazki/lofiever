import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from '@/lib/config';
import { ORIGINAL_MUSIC_ALBUM } from './constants';
import { MusicGenerationError } from './errors';
import type { ValidatedMusicAudio } from './types';

const execFileAsync = promisify(execFile);
const MIN_DURATION_SECONDS = 145;
const MAX_DURATION_SECONDS = 190;
const MAX_SILENCE_RATIO = 0.2;

interface ProbeResult {
  format?: { duration?: string };
  streams?: Array<{
    codec_name?: string;
    sample_rate?: string;
    channels?: number;
    codec_type?: string;
  }>;
}

async function probe(filePath: string): Promise<{
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  codec: string;
}> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v', 'error',
        '-show_entries', 'format=duration:stream=codec_name,codec_type,sample_rate,channels',
        '-of', 'json',
        filePath,
      ],
      { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const result = JSON.parse(stdout) as ProbeResult;
    const audioStream = result.streams?.find((stream) => stream.codec_type === 'audio');
    return {
      durationSeconds: Number.parseFloat(result.format?.duration || '0'),
      sampleRate: Number.parseInt(audioStream?.sample_rate || '0', 10),
      channels: audioStream?.channels || 0,
      codec: audioStream?.codec_name || '',
    };
  } catch (error) {
    throw new MusicGenerationError(
      'AUDIO_PROBE_FAILED',
      `O arquivo gerado não pôde ser analisado: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      true,
    );
  }
}

async function inspectLevels(filePath: string, durationSeconds: number): Promise<{
  maxVolumeDb: number | null;
  silenceRatio: number;
}> {
  try {
    const [{ stderr: volumeOutput }, { stderr: silenceOutput }] = await Promise.all([
      execFileAsync(
        'ffmpeg',
        ['-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'],
        { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      ),
      execFileAsync(
        'ffmpeg',
        ['-hide_banner', '-i', filePath, '-af', 'silencedetect=noise=-50dB:d=4', '-f', 'null', '-'],
        { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      ),
    ]);

    const maxVolumeMatch = volumeOutput.match(/max_volume:\s*(-?[\d.]+)\s*dB/i);
    const silenceDurations = [...silenceOutput.matchAll(/silence_duration:\s*([\d.]+)/gi)]
      .map((match) => Number.parseFloat(match[1]))
      .filter(Number.isFinite);
    const totalSilence = silenceDurations.reduce((total, value) => total + value, 0);

    return {
      maxVolumeDb: maxVolumeMatch ? Number.parseFloat(maxVolumeMatch[1]) : null,
      silenceRatio: durationSeconds > 0 ? Math.min(1, totalSilence / durationSeconds) : 1,
    };
  } catch (error) {
    throw new MusicGenerationError(
      'AUDIO_ANALYSIS_FAILED',
      `Não foi possível medir silêncio e volume: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      true,
    );
  }
}

interface MusicAudioMetadata {
  title: string;
  artist: string;
}

async function normalizeAudio(
  inputPath: string,
  outputPath: string,
  metadata?: MusicAudioMetadata,
): Promise<void> {
  try {
    const metadataArgs = metadata
      ? [
          '-metadata', `title=${metadata.title}`,
          '-metadata', `artist=${metadata.artist}`,
          '-metadata', `album=${ORIGINAL_MUSIC_ALBUM}`,
        ]
      : [];
    await execFileAsync(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', inputPath,
        '-af', 'loudnorm=I=-14:TP=-1:LRA=11',
        '-ar', '44100', '-ac', '2',
        '-codec:a', 'libmp3lame', '-b:a', '192k',
        ...metadataArgs,
        outputPath,
      ],
      { timeout: 4 * 60_000, maxBuffer: 4 * 1024 * 1024 },
    );
  } catch (error) {
    throw new MusicGenerationError(
      'AUDIO_NORMALIZATION_FAILED',
      `Não foi possível normalizar o áudio: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      true,
    );
  }
}

function meaningfulTranscript(text: string): string {
  return text
    .replace(/\[(?:music|instrumental|applause|silence)\]/gi, '')
    .replace(/[♪♫]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface WhisperSegment {
  text?: string;
  avg_logprob?: number;
  no_speech_prob?: number;
}

function confidentSpeechTranscript(segments: WhisperSegment[]): string {
  return meaningfulTranscript(
    segments
      .filter((segment) => {
        const text = meaningfulTranscript(segment.text || '');
        const words = text.split(/\s+/).filter((word) => /[\p{L}\d]/u.test(word));
        return words.length >= 3
          && typeof segment.no_speech_prob === 'number'
          && segment.no_speech_prob < 0.35
          && typeof segment.avg_logprob === 'number'
          && segment.avg_logprob > -1;
      })
      .map((segment) => segment.text || '')
      .join(' '),
  );
}

async function transcribeForVocalCheck(audio: Buffer): Promise<string | null> {
  if (!config.musicGeneration.requireVocalCheck) return null;
  if (!process.env.OPENAI_API_KEY) {
    throw new MusicGenerationError(
      'VOCAL_CHECK_UNAVAILABLE',
      'OPENAI_API_KEY é necessária para a validação automática de vocais.',
      true,
    );
  }

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), 'track.mp3');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');

  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(3 * 60_000),
    });
  } catch (error) {
    throw new MusicGenerationError(
      'VOCAL_CHECK_UNAVAILABLE',
      `O detector de vocais não respondeu: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      true,
    );
  }

  if (!response.ok) {
    throw new MusicGenerationError(
      'VOCAL_CHECK_UNAVAILABLE',
      `O detector de vocais devolveu HTTP ${response.status}.`,
      response.status >= 500 || response.status === 429,
    );
  }

  const result = await response.json() as { text?: string; segments?: WhisperSegment[] };
  const transcript = result.segments
    ? confidentSpeechTranscript(result.segments)
    : meaningfulTranscript(result.text || '');
  const words = transcript.split(/\s+/).filter((word) => /[\p{L}\d]/u.test(word));
  if (words.length >= 3) {
    throw new MusicGenerationError(
      'VOCALS_DETECTED',
      'A validação detectou voz ou fala na faixa instrumental.',
      true,
    );
  }

  return transcript || null;
}

export async function validateAndNormalizeMusicAudio(
  audio: Buffer,
  metadata?: MusicAudioMetadata,
): Promise<ValidatedMusicAudio> {
  const directory = await mkdtemp(join(tmpdir(), 'lofiever-music-'));
  const inputPath = join(directory, 'original.mp3');
  const outputPath = join(directory, 'streaming.mp3');

  try {
    await writeFile(inputPath, audio);
    const originalProbe = await probe(inputPath);

    if (
      !Number.isFinite(originalProbe.durationSeconds)
      || originalProbe.durationSeconds < MIN_DURATION_SECONDS
      || originalProbe.durationSeconds > MAX_DURATION_SECONDS
    ) {
      throw new MusicGenerationError(
        'INVALID_AUDIO_DURATION',
        `Duração fora do intervalo aceito: ${originalProbe.durationSeconds.toFixed(1)}s.`,
        true,
      );
    }

    if (originalProbe.codec !== 'mp3' || originalProbe.sampleRate !== 44_100 || originalProbe.channels < 1) {
      throw new MusicGenerationError(
        'INVALID_AUDIO_FORMAT',
        `Formato inesperado: ${originalProbe.codec}, ${originalProbe.sampleRate} Hz, ${originalProbe.channels} canal(is).`,
        true,
      );
    }

    const originalLevels = await inspectLevels(inputPath, originalProbe.durationSeconds);
    if (originalLevels.silenceRatio > MAX_SILENCE_RATIO) {
      throw new MusicGenerationError(
        'EXCESSIVE_SILENCE',
        `A faixa contém ${(originalLevels.silenceRatio * 100).toFixed(0)}% de silêncio.`,
        true,
      );
    }

    const transcript = await transcribeForVocalCheck(audio);
    await normalizeAudio(inputPath, outputPath, metadata);
    const streamingAudio = await readFile(outputPath);
    const normalizedProbe = await probe(outputPath);
    const normalizedLevels = await inspectLevels(outputPath, normalizedProbe.durationSeconds);
    if (normalizedLevels.maxVolumeDb !== null && normalizedLevels.maxVolumeDb > -0.1) {
      throw new MusicGenerationError(
        'AUDIO_CLIPPING_DETECTED',
        `O pico normalizado ficou alto demais (${normalizedLevels.maxVolumeDb.toFixed(1)} dB).`,
        true,
      );
    }
    const sha256 = createHash('sha256').update(streamingAudio).digest('hex');

    return {
      streamingAudio,
      report: {
        durationSeconds: Math.round(normalizedProbe.durationSeconds),
        sampleRate: normalizedProbe.sampleRate,
        channels: normalizedProbe.channels,
        codec: normalizedProbe.codec,
        maxVolumeDb: normalizedLevels.maxVolumeDb,
        silenceRatio: originalLevels.silenceRatio,
        transcript,
        sha256,
        normalized: true,
      },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
