"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/diagnose-playlist.ts
var import_client = require("@prisma/client");
var import_ioredis2 = require("ioredis");

// src/lib/redis.ts
var import_ioredis = __toESM(require("ioredis"));

// src/lib/config.ts
var config = {
  app: {
    name: "Lofiever",
    description: "24/7 Lofi Streaming with AI Curation",
    url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    env: process.env.NODE_ENV || "development"
  },
  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
    maxRetriesPerRequest: 3
  },
  database: {
    url: process.env.DATABASE_URL
  },
  socket: {
    path: "/api/ws",
    transports: ["websocket"]
  },
  auth: {
    secret: process.env.AUTH_SECRET,
    providers: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET
      }
    }
  },
  streaming: {
    chunkDuration: 10,
    // seconds
    playlistSize: 100,
    maxCacheAge: 60 * 60 * 24
    // 24 hours
  },
  // ... (código existente) ...
  liquidsoap: {
    musicDir: process.env.LIQUIDSOAP_MUSIC_DIR || "/music",
    fallback: "example.mp3"
  },
  r2: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    endpoint: process.env.R2_ENDPOINT || "",
    // Ex: https://<account_id>.r2.cloudflarestorage.com
    bucket: process.env.R2_BUCKET_NAME || "",
    publicUrl: process.env.R2_PUBLIC_URL || ""
    // Ex: https://pub-<bucket_id>.r2.dev
  }
};

// src/lib/redis.ts
var REDIS_PREFIXES = {
  PLAYBACK: "lofiever:playback:",
  PLAYLIST: "lofiever:playlist:",
  USER: "lofiever:user:",
  CHAT: "lofiever:chat:",
  CACHE: "lofiever:cache:",
  ANALYTICS: "lofiever:analytics:"
};
var KEYS = {
  // Playback related keys
  CURRENT_TRACK: `${REDIS_PREFIXES.PLAYBACK}current_track`,
  PLAYBACK_STATE: `${REDIS_PREFIXES.PLAYBACK}state`,
  PLAYBACK_POSITION: `${REDIS_PREFIXES.PLAYBACK}position`,
  LISTENERS_COUNT: `${REDIS_PREFIXES.ANALYTICS}listeners_count`,
  LISTENERS_SET: `${REDIS_PREFIXES.ANALYTICS}listeners_zset`,
  // Changed to zset for timestamp-based tracking
  // Playlist related keys
  ACTIVE_PLAYLIST: `${REDIS_PREFIXES.PLAYLIST}active`,
  PLAYLIST_VERSION: `${REDIS_PREFIXES.PLAYLIST}version`,
  PLAYLIST_HISTORY: `${REDIS_PREFIXES.PLAYLIST}history`,
  PLAYLIST_UPCOMING: `${REDIS_PREFIXES.PLAYLIST}upcoming`,
  PLAYLIST_VOTE: `${REDIS_PREFIXES.PLAYLIST}vote`,
  // User related keys
  USER_SESSIONS: `${REDIS_PREFIXES.USER}sessions`,
  USER_PREFERENCES: `${REDIS_PREFIXES.USER}preferences`,
  // Chat related keys
  CHAT_MESSAGES: `${REDIS_PREFIXES.CHAT}messages`,
  CHAT_USERS_ACTIVE: `${REDIS_PREFIXES.CHAT}users_active`,
  // Cache related keys
  TRACK_CACHE: `${REDIS_PREFIXES.CACHE}tracks`,
  PLAYLIST_CACHE: `${REDIS_PREFIXES.CACHE}playlists`
};
var isBuildTime = process.env.NODE_ENV === "production" && !process.env.REDIS_URL;
var RedisManager = class _RedisManager {
  constructor() {
    this.client = null;
    this.subscriberClient = null;
    this.isConnected = false;
    if (isBuildTime) {
      console.log("Redis: Skipping connection during build time");
      return;
    }
  }
  initializeClient() {
    if (this.client) return this.client;
    this.client = new import_ioredis.default(config.redis.url, {
      maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
      retryStrategy: (times) => {
        if (times > 3) {
          console.error(`Redis connection failed after ${times} attempts`);
          return null;
        }
        return Math.min(times * 50, 2e3);
      },
      connectionName: "lofiever:main",
      enableReadyCheck: true,
      enableOfflineQueue: true,
      lazyConnect: true
    });
    this.setupEventHandlers();
    return this.client;
  }
  setupEventHandlers() {
    if (!this.client) return;
    this.client.on("connect", () => {
      console.log("Redis client connected");
    });
    this.client.on("ready", () => {
      console.log("Redis client ready");
      this.isConnected = true;
    });
    this.client.on("error", (err) => {
      console.error("Redis client error:", err);
      this.isConnected = false;
    });
    this.client.on("close", () => {
      console.log("Redis client disconnected");
      this.isConnected = false;
    });
    this.client.on("reconnecting", (delay) => {
      console.log(`Redis client reconnecting in ${delay}ms`);
    });
  }
  static getInstance() {
    if (!_RedisManager.instance) {
      _RedisManager.instance = new _RedisManager();
    }
    return _RedisManager.instance;
  }
  getClient() {
    if (isBuildTime) {
      throw new Error("Redis is not available during build time");
    }
    return this.initializeClient();
  }
  async getSubscriberClient() {
    if (isBuildTime) {
      throw new Error("Redis is not available during build time");
    }
    if (!this.subscriberClient) {
      this.subscriberClient = new import_ioredis.default(config.redis.url, {
        connectionName: "lofiever:subscriber",
        maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
        lazyConnect: true
      });
      this.subscriberClient.on("error", (err) => {
        console.error("Redis subscriber client error:", err);
      });
    }
    return this.subscriberClient;
  }
  isReady() {
    return this.isConnected;
  }
  async ping() {
    if (isBuildTime || !this.client) {
      return null;
    }
    try {
      return await this.client.ping();
    } catch (error) {
      console.error("Redis ping failed:", error);
      return null;
    }
  }
  async disconnect() {
    if (this.client) {
      await this.client.quit();
    }
    if (this.subscriberClient) {
      await this.subscriberClient.quit();
    }
  }
};
var redisManager = RedisManager.getInstance();
var _redis = null;
var redis = new Proxy({}, {
  get(_, prop) {
    if (isBuildTime) {
      if (typeof prop === "string") {
        return () => Promise.resolve(null);
      }
      return void 0;
    }
    if (!_redis) {
      _redis = redisManager.getClient();
    }
    const value = _redis[prop];
    if (typeof value === "function") {
      return value.bind(_redis);
    }
    return value;
  }
});

// scripts/diagnose-playlist.ts
var prisma = new import_client.PrismaClient();
var redis2 = new import_ioredis2.Redis(process.env.REDIS_URL || "redis://localhost:6379");
async function diagnose() {
  console.log("=== DIAGN\xD3STICO DA PLAYLIST ===\n");
  console.log("1. PLAYLIST ATIVA:");
  const playlist = await prisma.playlist.findFirst({
    where: { active: true },
    include: {
      tracks: {
        orderBy: { position: "asc" },
        take: 5,
        include: { track: true }
      },
      _count: { select: { tracks: true } }
    }
  });
  if (playlist) {
    console.log(`   ID: ${playlist.id}`);
    console.log(`   Version: ${playlist.version}`);
    console.log(`   Total tracks: ${playlist._count.tracks}`);
    console.log(`   Primeiras 5 tracks:`);
    playlist.tracks.forEach((pt, i) => {
      console.log(`     ${i}. [pos ${pt.position}] ${pt.track.title} - ${pt.track.artist}`);
    });
  } else {
    console.log("   \u274C Nenhuma playlist ativa encontrada!");
  }
  console.log("\n2. ESTADO NO REDIS:");
  const position = await redis2.get("lofiever:playlist:position");
  const currentTrack = await redis2.get(KEYS.CURRENT_TRACK);
  const listenersCount = await redis2.get(KEYS.LISTENERS_COUNT);
  console.log(`   Posi\xE7\xE3o atual: ${position || "n\xE3o definida"}`);
  console.log(`   Listeners: ${listenersCount || "0"}`);
  if (currentTrack) {
    const track = JSON.parse(currentTrack);
    console.log(`   Track atual: "${track.title}" - ${track.artist}`);
  } else {
    console.log("   Track atual: n\xE3o definida");
  }
  console.log("\n3. HIST\xD3RICO DE PLAYBACK:");
  const historyCount = await prisma.playbackHistory.count();
  const recentHistory = await prisma.playbackHistory.findMany({
    take: 5,
    orderBy: { startedAt: "desc" },
    include: { track: true }
  });
  console.log(`   Total de registros: ${historyCount}`);
  if (recentHistory.length > 0) {
    console.log("   \xDAltimas 5 m\xFAsicas tocadas:");
    recentHistory.forEach((h, i) => {
      const time = h.startedAt.toLocaleTimeString("pt-BR");
      console.log(`     ${i + 1}. [${time}] ${h.track.title} - ${h.track.artist}`);
    });
  } else {
    console.log("   \u274C Nenhum hist\xF3rico encontrado!");
  }
  console.log("\n4. AMOSTRA DE TRACKS:");
  const sampleTrack = await prisma.track.findFirst({
    select: {
      id: true,
      title: true,
      artist: true,
      sourceType: true,
      sourceId: true,
      artworkKey: true
    }
  });
  if (sampleTrack) {
    console.log(`   ID: ${sampleTrack.id}`);
    console.log(`   Title: ${sampleTrack.title}`);
    console.log(`   Artist: ${sampleTrack.artist}`);
    console.log(`   Source Type: ${sampleTrack.sourceType}`);
    console.log(`   Source ID: ${sampleTrack.sourceId?.substring(0, 50)}...`);
    console.log(`   Artwork Key: ${sampleTrack.artworkKey || "n\xE3o definido"}`);
  }
  console.log("\n5. SIMULA\xC7\xC3O DE /api/next-track:");
  if (playlist && playlist.tracks.length > 0) {
    const currentPos = position ? parseInt(position, 10) : -1;
    const nextPos = (currentPos + 1) % playlist._count.tracks;
    const nextTrackItem = await prisma.playlistTrack.findFirst({
      where: {
        playlistId: playlist.id,
        position: nextPos
      },
      include: { track: true }
    });
    if (nextTrackItem) {
      console.log(`   Pr\xF3xima posi\xE7\xE3o: ${nextPos}`);
      console.log(`   Pr\xF3xima track: "${nextTrackItem.track.title}" - ${nextTrackItem.track.artist}`);
      console.log(`   Source: ${nextTrackItem.track.sourceType} -> ${nextTrackItem.track.sourceId?.substring(0, 50)}...`);
    } else {
      console.log(`   \u274C N\xE3o encontrou track na posi\xE7\xE3o ${nextPos}`);
    }
  }
  console.log("\n=== RESUMO ===");
  const issues = [];
  if (!playlist) {
    issues.push("Criar playlist ativa");
  }
  if (!position) {
    issues.push("Inicializar posi\xE7\xE3o da playlist (pnpm playlist:reset)");
  }
  if (historyCount === 0) {
    issues.push("Hist\xF3rico vazio - precisa chamar /api/next-track");
  }
  if (issues.length === 0) {
    console.log("\u2705 Tudo parece OK!");
  } else {
    console.log("\u274C Problemas encontrados:");
    issues.forEach((issue) => console.log(`   - ${issue}`));
  }
  await prisma.$disconnect();
  await redis2.quit();
}
diagnose().catch(console.error);
