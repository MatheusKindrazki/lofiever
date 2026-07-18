import { createHash } from 'node:crypto';
import { MusicGenerationError } from './errors';

const IMITATION_PATTERNS = [
  /\b(no estilo de|igual (?:a|ao)|parecid[oa] com|inspirad[oa] (?:em|por))\b/i,
  /\b(in the style of|sounds? like|imitat(?:e|ing)|inspired by)\b/i,
  /\b(?:música|musica|song|track)\s+(?:do|da|de|by)\s+[\p{L}\d]/iu,
];

const VOCAL_PATTERNS = [
  /\b(com vocais?|cantad[oa]|cantor(?:a)?|letras? da música|rap|falad[oa])\b/i,
  /\b(with vocals?|singer|lyrics?|spoken word|rapping)\b/i,
];

const UNSAFE_PATTERNS = [
  /\b(?:hate|ódio|odio|racist|racista|nazis?|terroris(?:m|ta))\b/i,
  /https?:\/\//i,
];

const MOOD_ALIASES: Array<[RegExp, string]> = [
  [/\b(chuva|rain|chuvoso)\b/i, 'rainy'],
  [/\b(estudo|study|foco|focus|concentra)\b/i, 'focused'],
  [/\b(noite|night|noturno)\b/i, 'night'],
  [/\b(calmo|calm|relax|tranquil)\b/i, 'calm'],
  [/\b(alegre|happy|solar|sunny)\b/i, 'warm'],
  [/\b(melanc|sad|saudade)\b/i, 'melancholic'],
];

export interface NormalizedMusicPrompt {
  originalPrompt: string;
  normalizedPrompt: string;
  promptHash: string;
  title: string;
  mood: string;
  bpm: number;
  durationSeconds: number;
  moderationResult: {
    instrumentalOnly: true;
    imitationBlocked: true;
    unsafeContentBlocked: true;
  };
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function redactPersonalData(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email removido]')
    .replace(/(?:\+?\d[\s().-]?){8,15}/g, '[telefone removido]')
    .replace(/(^|\s)@[a-z0-9_]{2,30}\b/gi, '$1[usuário removido]');
}

function cleanTitle(value: string | undefined, mood: string): string {
  const cleaned = compact(value || '')
    .replace(/[<>]/g, '')
    .slice(0, 80);

  if (cleaned.length >= 3) return cleaned;

  const suffix = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `${mood.charAt(0).toUpperCase()}${mood.slice(1)} Session ${suffix}`;
}

function resolveMood(prompt: string, requestedMood?: string): string {
  const cleanedMood = compact(requestedMood || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (cleanedMood.length >= 3 && cleanedMood.length <= 30) return cleanedMood;

  return MOOD_ALIASES.find(([pattern]) => pattern.test(prompt))?.[1] || 'calm';
}

function resolveBpm(prompt: string, requestedBpm?: number): number {
  const promptBpm = prompt.match(/\b(\d{2,3})\s*bpm\b/i)?.[1];
  const value = requestedBpm ?? (promptBpm ? Number.parseInt(promptBpm, 10) : 72);
  return Math.min(95, Math.max(55, Math.round(value)));
}

export function normalizeMusicPrompt(input: {
  prompt: string;
  title?: string;
  mood?: string;
  bpm?: number;
  durationSeconds: number;
}): NormalizedMusicPrompt {
  const originalPrompt = redactPersonalData(compact(input.prompt));

  if (originalPrompt.length < 10 || originalPrompt.length > 600) {
    throw new MusicGenerationError(
      'INVALID_PROMPT',
      'Descreva a faixa em uma frase de 10 a 600 caracteres.',
    );
  }

  if (IMITATION_PATTERNS.some((pattern) => pattern.test(originalPrompt))) {
    throw new MusicGenerationError(
      'INVALID_PROMPT',
      'Não posso imitar artistas ou músicas existentes. Descreva instrumentos, clima e ritmo.',
    );
  }

  if (VOCAL_PATTERNS.some((pattern) => pattern.test(originalPrompt))) {
    throw new MusicGenerationError(
      'INVALID_PROMPT',
      'Por enquanto o estúdio cria somente lo-fi instrumental, sem voz ou letra.',
    );
  }

  if (UNSAFE_PATTERNS.some((pattern) => pattern.test(originalPrompt))) {
    throw new MusicGenerationError('INVALID_PROMPT', 'Esse pedido não pode ser produzido pela rádio.');
  }

  const mood = resolveMood(originalPrompt, input.mood);
  const bpm = resolveBpm(originalPrompt, input.bpm);
  const durationSeconds = Math.min(184, Math.max(150, input.durationSeconds));
  const title = cleanTitle(input.title, mood);
  const normalizedPrompt = [
    'A warm, modern lo-fi hip-hop instrumental for focused listening on a calm 24/7 radio station.',
    `Creative direction: ${originalPrompt}.`,
    `Mood: ${mood}. Tempo: ${bpm} BPM. Duration: about ${durationSeconds} seconds.`,
    'Instrumental. Use a clear beginning, gentle development, and a clean ending.',
  ].join(' ');

  return {
    originalPrompt,
    normalizedPrompt,
    promptHash: createHash('sha256').update(normalizedPrompt).digest('hex'),
    title,
    mood,
    bpm,
    durationSeconds,
    moderationResult: {
      instrumentalOnly: true,
      imitationBlocked: true,
      unsafeContentBlocked: true,
    },
  };
}
