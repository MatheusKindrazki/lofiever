export const config = {
  app: {
    name: 'Lofiever',
    description: '24/7 Lofi Streaming with AI Curation',
    url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    env: process.env.NODE_ENV || 'development',
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
} as const;

// Create a separate type declaration file for environment variables
// ... (código existente) ... 