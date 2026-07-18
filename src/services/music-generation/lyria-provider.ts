import { GoogleAuth } from 'google-auth-library';
import { config } from '@/lib/config';
import { MusicGenerationError } from './errors';
import type {
  GeneratedMusicAudio,
  MusicGenerationProvider,
  MusicGenerationProviderInput,
} from './types';

const API_BASE = 'https://aiplatform.googleapis.com/v1beta1/projects';
const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_TIME_MS = 12 * 60 * 1_000;

interface InteractionResponse {
  id?: string;
  status?: 'in_progress' | 'requires_action' | 'completed' | 'failed' | 'cancelled' | 'incomplete';
  model?: string;
  outputs?: unknown[];
  steps?: unknown[];
  error?: { message?: string; code?: string };
  [key: string]: unknown;
}

function parseServiceAccountCredentials(): Record<string, string> | undefined {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return undefined;

  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('credential JSON must be an object');
    }
    return value as Record<string, string>;
  } catch (error) {
    throw new MusicGenerationError(
      'PROVIDER_CONFIGURATION_ERROR',
      `GOOGLE_SERVICE_ACCOUNT_JSON inválido: ${error instanceof Error ? error.message : 'JSON inválido'}`,
    );
  }
}

function findAudioOutput(value: unknown): { data: string; mimeType: string } | null {
  if (!value || typeof value !== 'object') return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAudioOutput(item);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  const type = record.type;
  const data = record.data;
  const mimeType = record.mime_type || record.mimeType;
  if (type === 'audio' && typeof data === 'string' && typeof mimeType === 'string') {
    return { data, mimeType };
  }

  for (const child of Object.values(record)) {
    const found = findAudioOutput(child);
    if (found) return found;
  }
  return null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class LyriaMusicProvider implements MusicGenerationProvider {
  readonly name = 'google-lyria';
  readonly model = config.musicGeneration.google.model;
  readonly costPerAttemptUsd = 0.08;

  private readonly auth = new GoogleAuth({
    projectId: config.musicGeneration.google.projectId || undefined,
    credentials: parseServiceAccountCredentials(),
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  async generate(input: MusicGenerationProviderInput): Promise<GeneratedMusicAudio> {
    const projectId = config.musicGeneration.google.projectId || await this.auth.getProjectId();
    if (!projectId) {
      throw new MusicGenerationError(
        'PROVIDER_CONFIGURATION_ERROR',
        'GOOGLE_CLOUD_PROJECT não está configurado.',
      );
    }

    const endpoint = `${API_BASE}/${encodeURIComponent(projectId)}/locations/global/interactions`;
    const response = await this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify({
        model: this.model,
        input: [{ type: 'text', text: input.prompt }],
      }),
    });

    if (response.id && input.onOperationId) {
      await input.onOperationId(response.id);
    }

    const completed = response.status === 'completed'
      ? response
      : await this.pollUntilComplete(endpoint, response);

    const audioOutput = findAudioOutput(completed);
    if (!audioOutput || audioOutput.mimeType !== 'audio/mpeg') {
      throw new MusicGenerationError(
        'PROVIDER_INVALID_OUTPUT',
        'O Lyria concluiu a operação sem devolver um MP3 válido.',
        true,
      );
    }

    let audio: Buffer;
    try {
      audio = Buffer.from(audioOutput.data, 'base64');
    } catch {
      throw new MusicGenerationError(
        'PROVIDER_INVALID_OUTPUT',
        'O áudio devolvido pelo Lyria não pôde ser decodificado.',
        true,
      );
    }

    if (audio.length < 100_000) {
      throw new MusicGenerationError(
        'PROVIDER_INVALID_OUTPUT',
        'O áudio devolvido pelo Lyria está incompleto.',
        true,
      );
    }

    return {
      audio,
      mimeType: 'audio/mpeg',
      model: completed.model || this.model,
      provider: this.name,
      operationId: completed.id || response.id,
      providerMetadata: {
        status: completed.status,
        requestedDurationSeconds: input.durationSeconds,
      },
    };
  }

  private async pollUntilComplete(
    endpoint: string,
    initial: InteractionResponse,
  ): Promise<InteractionResponse> {
    if (!initial.id) {
      throw new MusicGenerationError(
        'PROVIDER_INVALID_OUTPUT',
        'O Lyria não devolveu o identificador da geração.',
        true,
      );
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < MAX_POLL_TIME_MS) {
      await delay(POLL_INTERVAL_MS);
      const interaction = await this.request(`${endpoint}/${encodeURIComponent(initial.id)}`, {
        method: 'GET',
      });

      if (interaction.status === 'completed') return interaction;
      if (interaction.status === 'failed' || interaction.status === 'cancelled' || interaction.status === 'incomplete') {
        throw new MusicGenerationError(
          'PROVIDER_GENERATION_FAILED',
          interaction.error?.message || `O Lyria encerrou a geração com status ${interaction.status}.`,
          interaction.status === 'failed',
        );
      }
    }

    throw new MusicGenerationError(
      'PROVIDER_TIMEOUT',
      'A geração musical ultrapassou o tempo máximo de espera.',
      true,
    );
  }

  private async request(url: string, init: RequestInit): Promise<InteractionResponse> {
    const client = await this.auth.getClient();
    const accessToken = await client.getAccessToken();
    if (!accessToken.token) {
      throw new MusicGenerationError(
        'PROVIDER_AUTHENTICATION_ERROR',
        'Não foi possível autenticar no Google Cloud.',
        true,
      );
    }

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken.token}`,
          'Content-Type': 'application/json; charset=utf-8',
          ...init.headers,
        },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new MusicGenerationError(
        'PROVIDER_UNAVAILABLE',
        `Falha de conexão com o Lyria: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
        true,
      );
    }

    const body = await response.text();
    let parsed: InteractionResponse;
    try {
      parsed = JSON.parse(body) as InteractionResponse;
    } catch {
      throw new MusicGenerationError(
        'PROVIDER_INVALID_RESPONSE',
        `O Lyria devolveu uma resposta inválida (${response.status}).`,
        response.status >= 500 || response.status === 429,
      );
    }

    if (!response.ok) {
      throw new MusicGenerationError(
        'PROVIDER_REQUEST_REJECTED',
        parsed.error?.message || `O Lyria rejeitou a solicitação (${response.status}).`,
        response.status >= 500 || response.status === 408 || response.status === 429,
      );
    }

    return parsed;
  }
}
