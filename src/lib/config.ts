function pickFirstValidUrl(
  input: string | undefined,
  fallback: string,
): string {
  const values = [input || '', fallback]
    .flatMap((value) => value.split(/[,\s]+/))
    .map((value) => value.trim())
    .filter(Boolean);

  for (const value of values) {
    const candidate = value.startsWith('http://') || value.startsWith('https://')
      ? value
      : `https://${value}`;

    try {
      return new URL(candidate).toString().replace(/\/$/, '');
    } catch {
      // Try next candidate.
    }
  }

  return fallback;
}

const PUBLIC_APP_URL = pickFirstValidUrl(process.env.NEXT_PUBLIC_APP_URL, 'http://localhost:3000');
const INTERNAL_APP_URL = pickFirstValidUrl(process.env.APP_INTERNAL_URL, PUBLIC_APP_URL);

export const config = {
  app: {
    name: 'Lofiever',
    description: '24/7 Lofi Streaming with AI Curation',
    url: PUBLIC_APP_URL,
    internalUrl: INTERNAL_APP_URL,
    env: process.env.NODE_ENV || 'development',
  },
  admin: {
    allowedEmails: (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean),
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    maxRetriesPerRequest: 3,
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  socket: {
    path: '/api/ws',
    transports: ['websocket'] as const,
  },
  auth: {
    secret: process.env.AUTH_SECRET,
    providers: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
      },
    },
  },
  streaming: {
    chunkDuration: 10, // seconds
    playlistSize: 100,
    maxCacheAge: 60 * 60 * 24, // 24 hours
  },
// ... (código existente) ...
  liquidsoap: {
    musicDir: process.env.LIQUIDSOAP_MUSIC_DIR || '/music',
    fallback: 'example.mp3',
  },
  r2: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    endpoint: process.env.R2_ENDPOINT || '', // Ex: https://<account_id>.r2.cloudflarestorage.com
    bucket: process.env.R2_BUCKET_NAME || '',
    publicUrl: process.env.R2_PUBLIC_URL || '', // Ex: https://pub-<bucket_id>.r2.dev
  },
  youtube: {
    cookiesPath: process.env.YOUTUBE_COOKIES_PATH || '',
    cacheDir: process.env.YOUTUBE_CACHE_DIR || '/data/youtube-cache',
    cacheTtlDays: parseInt(process.env.YOUTUBE_CACHE_TTL_DAYS || '7', 10),
    audioFormat: process.env.YOUTUBE_AUDIO_FORMAT || 'opus',
    audioQuality: process.env.YOUTUBE_AUDIO_QUALITY || '0',
    enabled: process.env.YOUTUBE_ENABLED === 'true',
  },
  chat: {
    aiReplyMinListeners: (() => {
      const parsed = parseInt(process.env.AI_REPLY_MIN_LISTENERS || '1', 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    })(),
  },
} as const;

// Create a separate type declaration file for environment variables
// ... (código existente) ... 
