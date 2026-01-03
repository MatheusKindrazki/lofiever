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

// scripts/reset-playlist.ts
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

// scripts/reset-playlist.ts
var REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
async function resetPlaylist() {
  const redis2 = new import_ioredis2.Redis(REDIS_URL);
  try {
    await redis2.set("lofiever:playlist:position", "0");
    console.log("\u2705 Playlist position reset to 0");
    await redis2.del(KEYS.CURRENT_TRACK);
    console.log("\u{1F9F9} Cleared current track");
    await redis2.del(KEYS.PLAYLIST_CACHE);
    console.log("\u{1F9F9} Cleared playlist cache");
    await redis2.del(KEYS.PLAYBACK_STATE);
    console.log("\u{1F9F9} Cleared playback state");
    console.log("\n\u2705 Playlist reset complete!");
    console.log("Next call to /api/next-track will start from position 0");
  } catch (error) {
    console.error("\u274C Error resetting playlist:", error);
  } finally {
    await redis2.quit();
  }
}
resetPlaylist();
