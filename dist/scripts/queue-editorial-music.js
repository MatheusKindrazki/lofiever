"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
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

// src/lib/config.ts
function pickFirstValidUrl(input, fallback) {
  const values = [input || "", fallback].flatMap((value) => value.split(/[,\s]+/)).map((value) => value.trim()).filter(Boolean);
  for (const value of values) {
    const candidate = value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`;
    try {
      return new URL(candidate).toString().replace(/\/$/, "");
    } catch {
    }
  }
  return fallback;
}
function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function positiveNumber(value, fallback) {
  const parsed = Number.parseFloat(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
var PUBLIC_APP_URL, INTERNAL_APP_URL, config;
var init_config = __esm({
  "src/lib/config.ts"() {
    "use strict";
    PUBLIC_APP_URL = pickFirstValidUrl(process.env.NEXT_PUBLIC_APP_URL, "http://localhost:3000");
    INTERNAL_APP_URL = pickFirstValidUrl(process.env.APP_INTERNAL_URL, PUBLIC_APP_URL);
    config = {
      app: {
        name: "Lofiever",
        description: "24/7 Lofi Streaming with AI Curation",
        url: PUBLIC_APP_URL,
        internalUrl: INTERNAL_APP_URL,
        env: process.env.NODE_ENV || "development"
      },
      admin: {
        allowedEmails: (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean)
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
      },
      youtube: {
        cookiesPath: process.env.YOUTUBE_COOKIES_PATH || "",
        cacheDir: process.env.YOUTUBE_CACHE_DIR || "/data/youtube-cache",
        cacheTtlDays: parseInt(process.env.YOUTUBE_CACHE_TTL_DAYS || "7", 10),
        audioFormat: process.env.YOUTUBE_AUDIO_FORMAT || "opus",
        audioQuality: process.env.YOUTUBE_AUDIO_QUALITY || "0",
        enabled: process.env.YOUTUBE_ENABLED === "true"
      },
      chat: {
        aiReplyMinListeners: (() => {
          const parsed = parseInt(process.env.AI_REPLY_MIN_LISTENERS || "1", 10);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
        })()
      },
      musicGeneration: {
        enabled: process.env.AI_MUSIC_ENABLED === "true",
        provider: process.env.AI_MUSIC_PROVIDER || "google-lyria",
        userDailyLimit: positiveInteger(process.env.AI_MUSIC_USER_DAILY_LIMIT, 1),
        globalDailyLimit: positiveInteger(process.env.AI_MUSIC_GLOBAL_DAILY_LIMIT, 20),
        editorialDailyTarget: positiveInteger(process.env.AI_MUSIC_EDITORIAL_DAILY_TARGET, 2),
        editorialCatalogTarget: positiveInteger(process.env.AI_MUSIC_EDITORIAL_CATALOG_TARGET, 300),
        editorialWeeklyTarget: positiveInteger(process.env.AI_MUSIC_EDITORIAL_WEEKLY_TARGET, 3),
        monthlyBudgetUsd: positiveNumber(process.env.AI_MUSIC_MONTHLY_BUDGET_USD, 100),
        maxAttempts: positiveInteger(process.env.AI_MUSIC_MAX_ATTEMPTS, 2),
        targetDurationSeconds: positiveInteger(process.env.AI_MUSIC_TARGET_DURATION_SECONDS, 180),
        requireVocalCheck: process.env.AI_MUSIC_REQUIRE_VOCAL_CHECK !== "false",
        ipHashSecret: process.env.AI_MUSIC_IP_HASH_SECRET || process.env.AUTH_SECRET || "",
        google: {
          projectId: process.env.GOOGLE_CLOUD_PROJECT || "",
          model: process.env.GOOGLE_LYRIA_MODEL || "lyria-3-pro-preview"
        }
      }
    };
  }
});

// src/services/music-generation/queue.ts
var queue_exports = {};
__export(queue_exports, {
  MUSIC_GENERATION_QUEUE: () => MUSIC_GENERATION_QUEUE,
  closeMusicGenerationQueue: () => closeMusicGenerationQueue,
  enqueueMusicGeneration: () => enqueueMusicGeneration
});
function getQueue() {
  if (!queue) {
    queueConnection = new import_ioredis.default(config.redis.url, {
      maxRetriesPerRequest: null,
      connectionName: "lofiever:music-generation-queue",
      lazyConnect: true
    });
    queue = new import_bullmq.Queue(MUSIC_GENERATION_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: {
        attempts: config.musicGeneration.maxAttempts,
        backoff: { type: "exponential", delay: 15e3 },
        removeOnComplete: { age: 24 * 60 * 60, count: 1e3 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 1e3 }
      }
    });
  }
  return queue;
}
async function enqueueMusicGeneration(generationId) {
  await getQueue().add("generate", { generationId }, { jobId: generationId });
}
async function closeMusicGenerationQueue() {
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (queueConnection) {
    await queueConnection.quit();
    queueConnection = null;
  }
}
var import_bullmq, import_ioredis, MUSIC_GENERATION_QUEUE, queue, queueConnection;
var init_queue = __esm({
  "src/services/music-generation/queue.ts"() {
    "use strict";
    import_bullmq = require("bullmq");
    import_ioredis = __toESM(require("ioredis"));
    init_config();
    MUSIC_GENERATION_QUEUE = "lofiever-music-generation";
    queue = null;
    queueConnection = null;
  }
});

// scripts/queue-editorial-music.ts
var import_config3 = require("dotenv/config");

// src/lib/prisma.ts
var import_client = require("@prisma/client");
var isBuildTime = process.env.NODE_ENV === "production" && !process.env.DATABASE_URL;
var globalForPrisma = global;
function createPrismaClient() {
  return new import_client.PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"]
  });
}
var _prisma = null;
function getPrismaClient() {
  if (isBuildTime) {
    throw new Error("Database is not available during build time");
  }
  if (!_prisma) {
    _prisma = globalForPrisma.prisma || createPrismaClient();
    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = _prisma;
    }
  }
  return _prisma;
}
var prisma = new Proxy({}, {
  get(_, prop) {
    if (isBuildTime) {
      if (typeof prop === "string") {
        return new Proxy({}, {
          get() {
            return () => Promise.resolve(null);
          }
        });
      }
      return void 0;
    }
    const client = getPrismaClient();
    const value = client[prop];
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  }
});

// scripts/queue-editorial-music.ts
init_queue();

// src/services/music-generation/service.ts
var import_node_crypto2 = require("node:crypto");
var import_client2 = require("@prisma/client");
init_config();

// src/services/music-generation/errors.ts
var MusicGenerationError = class extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.name = "MusicGenerationError";
  }
};

// src/services/music-generation/prompt-policy.ts
var import_node_crypto = require("node:crypto");
var IMITATION_PATTERNS = [
  /\b(no estilo de|igual (?:a|ao)|parecid[oa] com|inspirad[oa] (?:em|por))\b/i,
  /\b(in the style of|sounds? like|imitat(?:e|ing)|inspired by)\b/i,
  /\b(?:música|musica|song|track)\s+(?:do|da|de|by)\s+[\p{L}\d]/iu
];
var VOCAL_PATTERNS = [
  /\b(com vocais?|cantad[oa]|cantor(?:a)?|letras? da música|rap|falad[oa])\b/i,
  /\b(with vocals?|singer|lyrics?|spoken word|rapping)\b/i
];
var UNSAFE_PATTERNS = [
  /\b(?:hate|ódio|odio|racist|racista|nazis?|terroris(?:m|ta))\b/i,
  /https?:\/\//i
];
var MOOD_ALIASES = [
  [/\b(chuva|rain|chuvoso)\b/i, "rainy"],
  [/\b(estudo|study|foco|focus|concentra)\b/i, "focused"],
  [/\b(noite|night|noturno)\b/i, "night"],
  [/\b(calmo|calm|relax|tranquil)\b/i, "calm"],
  [/\b(alegre|happy|solar|sunny)\b/i, "warm"],
  [/\b(melanc|sad|saudade)\b/i, "melancholic"]
];
function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}
function redactPersonalData(value) {
  return value.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email removido]").replace(/(?:\+?\d[\s().-]?){8,15}/g, "[telefone removido]").replace(/(^|\s)@[a-z0-9_]{2,30}\b/gi, "$1[usu\xE1rio removido]");
}
function cleanTitle(value, mood) {
  const cleaned = compact(value || "").replace(/[<>]/g, "").slice(0, 80);
  if (cleaned.length >= 3) return cleaned;
  const suffix = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replaceAll("-", "");
  return `${mood.charAt(0).toUpperCase()}${mood.slice(1)} Session ${suffix}`;
}
function resolveMood(prompt, requestedMood) {
  const cleanedMood = compact(requestedMood || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (cleanedMood.length >= 3 && cleanedMood.length <= 30) return cleanedMood;
  return MOOD_ALIASES.find(([pattern]) => pattern.test(prompt))?.[1] || "calm";
}
function resolveBpm(prompt, requestedBpm) {
  const promptBpm = prompt.match(/\b(\d{2,3})\s*bpm\b/i)?.[1];
  const value = requestedBpm ?? (promptBpm ? Number.parseInt(promptBpm, 10) : 72);
  return Math.min(95, Math.max(55, Math.round(value)));
}
function normalizeMusicPrompt(input) {
  const originalPrompt = redactPersonalData(compact(input.prompt));
  if (originalPrompt.length < 10 || originalPrompt.length > 600) {
    throw new MusicGenerationError(
      "INVALID_PROMPT",
      "Descreva a faixa em uma frase de 10 a 600 caracteres."
    );
  }
  if (IMITATION_PATTERNS.some((pattern) => pattern.test(originalPrompt))) {
    throw new MusicGenerationError(
      "INVALID_PROMPT",
      "N\xE3o posso imitar artistas ou m\xFAsicas existentes. Descreva instrumentos, clima e ritmo."
    );
  }
  if (VOCAL_PATTERNS.some((pattern) => pattern.test(originalPrompt))) {
    throw new MusicGenerationError(
      "INVALID_PROMPT",
      "Por enquanto o est\xFAdio cria somente lo-fi instrumental, sem voz ou letra."
    );
  }
  if (UNSAFE_PATTERNS.some((pattern) => pattern.test(originalPrompt))) {
    throw new MusicGenerationError("INVALID_PROMPT", "Esse pedido n\xE3o pode ser produzido pela r\xE1dio.");
  }
  const mood = resolveMood(originalPrompt, input.mood);
  const bpm = resolveBpm(originalPrompt, input.bpm);
  const durationSeconds = Math.min(184, Math.max(150, input.durationSeconds));
  const title = cleanTitle(input.title, mood);
  const normalizedPrompt = [
    "A warm, modern lo-fi hip-hop instrumental for focused listening on a calm 24/7 radio station.",
    `Creative direction: ${originalPrompt}.`,
    `Mood: ${mood}. Tempo: ${bpm} BPM. Duration: about ${durationSeconds} seconds.`,
    "Instrumental. Use a clear beginning, gentle development, and a clean ending."
  ].join(" ");
  return {
    originalPrompt,
    normalizedPrompt,
    promptHash: (0, import_node_crypto.createHash)("sha256").update(normalizedPrompt).digest("hex"),
    title,
    mood,
    bpm,
    durationSeconds,
    moderationResult: {
      instrumentalOnly: true,
      imitationBlocked: true,
      unsafeContentBlocked: true
    }
  };
}

// src/services/music-generation/service.ts
var ACTIVE_OR_CONSUMED_STATUSES = [
  "QUEUED",
  "GENERATING",
  "VALIDATING",
  "PUBLISHED"
];
var ACTIVE_STATUSES = ["QUEUED", "GENERATING", "VALIDATING"];
var AGE_CONFIRMATION_VERSION = "google-genai-18plus-2026-07";
var RequestGateError = class extends Error {
  constructor(result) {
    super(result.message);
    this.result = result;
  }
};
function utcDayStart(now = /* @__PURE__ */ new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function utcMonthStart(now = /* @__PURE__ */ new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
function stableIdempotencyKey(userId, value) {
  if (!value) return void 0;
  return (0, import_node_crypto2.createHash)("sha256").update(`${userId || "editorial"}:${value}`).digest("hex");
}
function hashIp(ipAddress) {
  if (!ipAddress || !config.musicGeneration.ipHashSecret) return void 0;
  return (0, import_node_crypto2.createHmac)("sha256", config.musicGeneration.ipHashSecret).update(ipAddress).digest("hex");
}
function rejection(code, message) {
  return new RequestGateError({ accepted: false, code, message });
}
function acceptedResult(generation) {
  const published = generation.status === "PUBLISHED";
  return {
    accepted: true,
    generationId: generation.id,
    title: generation.title,
    status: published ? "published" : "queued",
    message: published ? `\u201C${generation.title}\u201D j\xE1 est\xE1 pronta no cat\xE1logo do Lofiever.` : `Peguei a ideia. Vou produzir \u201C${generation.title}\u201D e aviso quando ela entrar entre as pr\xF3ximas faixas.`
  };
}
async function serializable(operation) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : void 0;
      if (code !== "P2034") {
        throw error;
      }
    }
  }
  throw lastError;
}
var MusicGenerationService = {
  async requestGeneration(request) {
    if (!config.musicGeneration.enabled) {
      return {
        accepted: false,
        code: "FEATURE_DISABLED",
        message: "O est\xFAdio de faixas originais ainda n\xE3o est\xE1 aberto nesta instala\xE7\xE3o."
      };
    }
    if (request.source === "USER" && !request.userId) {
      return {
        accepted: false,
        code: "AUTH_REQUIRED",
        message: "Para criar uma faixa original, entre com sua conta e volte a fazer o pedido."
      };
    }
    let normalized;
    try {
      normalized = normalizeMusicPrompt({
        prompt: request.prompt,
        title: request.title,
        mood: request.mood,
        bpm: request.bpm,
        durationSeconds: config.musicGeneration.targetDurationSeconds
      });
    } catch (error) {
      if (error instanceof MusicGenerationError) {
        return { accepted: false, code: "INVALID_PROMPT", message: error.message };
      }
      throw error;
    }
    const idempotencyKey = stableIdempotencyKey(request.userId, request.idempotencyKey);
    const ipHash = hashIp(request.ipAddress);
    let generation;
    try {
      generation = await serializable(() => prisma.$transaction(async (tx) => {
        if (idempotencyKey) {
          const existing = await tx.musicGeneration.findUnique({ where: { idempotencyKey } });
          if (existing) return existing;
        }
        if (request.source === "USER") {
          const user = await tx.user.findUnique({ where: { id: request.userId } });
          if (!user?.ageConfirmedAt || user.ageConfirmationVersion !== AGE_CONFIRMATION_VERSION) {
            throw rejection(
              "AGE_CONFIRMATION_REQUIRED",
              "Antes do primeiro pedido, confirme no est\xFAdio que voc\xEA tem 18 anos ou mais."
            );
          }
          const dailyCount = await tx.musicGeneration.count({
            where: {
              source: "USER",
              userId: request.userId,
              status: { in: ACTIVE_OR_CONSUMED_STATUSES },
              createdAt: { gte: utcDayStart() }
            }
          });
          if (dailyCount >= config.musicGeneration.userDailyLimit) {
            throw rejection(
              "USER_DAILY_LIMIT",
              "Seu pedido original de hoje j\xE1 foi usado. O est\xFAdio reabre sua cota \xE0 meia-noite UTC."
            );
          }
          const globalCount = await tx.musicGeneration.count({
            where: {
              source: "USER",
              status: { in: ACTIVE_OR_CONSUMED_STATUSES },
              createdAt: { gte: utcDayStart() }
            }
          });
          if (globalCount >= config.musicGeneration.globalDailyLimit) {
            throw rejection(
              "GLOBAL_DAILY_LIMIT",
              "O est\xFAdio encerrou os pedidos de hoje. A agenda reabre \xE0 meia-noite UTC."
            );
          }
          const activeRequest = await tx.musicGeneration.findFirst({
            where: {
              source: "USER",
              status: { in: ACTIVE_STATUSES },
              OR: [
                { userId: request.userId },
                ...ipHash ? [{ ipHash }] : []
              ]
            },
            select: { id: true }
          });
          if (activeRequest) {
            throw rejection(
              "ACTIVE_REQUEST_EXISTS",
              "Seu est\xFAdio j\xE1 est\xE1 produzindo uma faixa. Aguarde essa gera\xE7\xE3o terminar."
            );
          }
        }
        const monthlySpend = await tx.musicGeneration.aggregate({
          where: { createdAt: { gte: utcMonthStart() } },
          _sum: { actualCostUsd: true }
        });
        if ((monthlySpend._sum.actualCostUsd || 0) >= config.musicGeneration.monthlyBudgetUsd) {
          throw rejection(
            "MONTHLY_BUDGET_REACHED",
            "O or\xE7amento mensal do est\xFAdio foi atingido. Novas gera\xE7\xF5es est\xE3o pausadas."
          );
        }
        return tx.musicGeneration.create({
          data: {
            source: request.source,
            userId: request.userId,
            username: request.username,
            ipHash,
            title: normalized.title,
            originalPrompt: normalized.originalPrompt,
            normalizedPrompt: normalized.normalizedPrompt,
            promptHash: normalized.promptHash,
            locale: request.locale || "pt",
            mood: normalized.mood,
            bpm: normalized.bpm,
            durationSeconds: normalized.durationSeconds,
            provider: config.musicGeneration.provider,
            model: config.musicGeneration.google.model,
            estimatedCostUsd: 0.08,
            moderationResult: normalized.moderationResult,
            idempotencyKey
          }
        });
      }, { isolationLevel: import_client2.Prisma.TransactionIsolationLevel.Serializable }));
    } catch (error) {
      if (error instanceof RequestGateError) return error.result;
      const prismaErrorCode = error && typeof error === "object" && "code" in error ? String(error.code) : void 0;
      if (prismaErrorCode === "P2002" && idempotencyKey) {
        const existing = await prisma.musicGeneration.findUnique({ where: { idempotencyKey } });
        if (existing) return acceptedResult(existing);
      }
      throw error;
    }
    if (generation.status !== "PUBLISHED") {
      try {
        const { enqueueMusicGeneration: enqueueMusicGeneration2 } = await Promise.resolve().then(() => (init_queue(), queue_exports));
        await enqueueMusicGeneration2(generation.id);
      } catch (error) {
        console.error("[MusicGeneration] Failed to enqueue generation:", error);
        await prisma.musicGeneration.update({
          where: { id: generation.id },
          data: {
            status: "FAILED",
            failureCode: "QUEUE_UNAVAILABLE",
            failureReason: error instanceof Error ? error.message : "Queue unavailable",
            completedAt: /* @__PURE__ */ new Date()
          }
        });
        return {
          accepted: false,
          code: "QUEUE_UNAVAILABLE",
          message: "O est\xFAdio n\xE3o conseguiu iniciar a produ\xE7\xE3o. Sua cota foi devolvida."
        };
      }
    }
    return acceptedResult(generation);
  },
  async confirmAdult(userId, username) {
    const now = /* @__PURE__ */ new Date();
    await prisma.user.upsert({
      where: { id: userId },
      update: {
        username,
        ageConfirmedAt: now,
        ageConfirmationVersion: AGE_CONFIRMATION_VERSION
      },
      create: {
        id: userId,
        username,
        ageConfirmedAt: now,
        ageConfirmationVersion: AGE_CONFIRMATION_VERSION
      }
    });
  },
  async getAccess(userId) {
    if (!userId) {
      return {
        enabled: config.musicGeneration.enabled,
        authenticated: false,
        ageConfirmed: false,
        remainingToday: 0,
        globalRemainingToday: 0
      };
    }
    const [user, userCount, globalCount] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.musicGeneration.count({
        where: {
          source: "USER",
          userId,
          status: { in: ACTIVE_OR_CONSUMED_STATUSES },
          createdAt: { gte: utcDayStart() }
        }
      }),
      prisma.musicGeneration.count({
        where: {
          source: "USER",
          status: { in: ACTIVE_OR_CONSUMED_STATUSES },
          createdAt: { gte: utcDayStart() }
        }
      })
    ]);
    return {
      enabled: config.musicGeneration.enabled,
      authenticated: true,
      ageConfirmed: Boolean(
        user?.ageConfirmedAt && user.ageConfirmationVersion === AGE_CONFIRMATION_VERSION
      ),
      remainingToday: Math.max(0, config.musicGeneration.userDailyLimit - userCount),
      globalRemainingToday: Math.max(0, config.musicGeneration.globalDailyLimit - globalCount)
    };
  },
  async reserveProviderAttempt(generationId, costUsd) {
    await serializable(() => prisma.$transaction(async (tx) => {
      const monthlySpend = await tx.musicGeneration.aggregate({
        where: { createdAt: { gte: utcMonthStart() } },
        _sum: { actualCostUsd: true }
      });
      if ((monthlySpend._sum.actualCostUsd || 0) + costUsd > config.musicGeneration.monthlyBudgetUsd) {
        throw new MusicGenerationError(
          "MONTHLY_BUDGET_REACHED",
          "O or\xE7amento mensal foi atingido antes desta tentativa."
        );
      }
      await tx.musicGeneration.update({
        where: { id: generationId },
        data: {
          status: "GENERATING",
          startedAt: /* @__PURE__ */ new Date(),
          attempts: { increment: 1 },
          actualCostUsd: { increment: costUsd },
          failureCode: null,
          failureReason: null
        }
      });
    }, { isolationLevel: import_client2.Prisma.TransactionIsolationLevel.Serializable }));
  }
};

// scripts/queue-editorial-music.ts
var DIRECTIONS = [
  {
    title: "Chuva Entre P\xE1ginas",
    mood: "rainy",
    bpm: 68,
    prompt: "Warm electric piano chords, soft vinyl texture, light rain around a quiet reading room, brushed drums, restrained bass, and a patient melody"
  },
  {
    title: "\xDAltimo Trem da Noite",
    mood: "night",
    bpm: 72,
    prompt: "Muted jazz guitar, distant electric piano, gentle train ambience, dusty drums, rounded bass, and a peaceful late-night progression"
  },
  {
    title: "Luzes na Janela",
    mood: "calm",
    bpm: 74,
    prompt: "Soft analog pads, sparse vibraphone, warm electric piano, gentle sub bass, compact drums, and rain-softened city ambience"
  },
  {
    title: "Caf\xE9 Antes do Sol",
    mood: "warm",
    bpm: 78,
    prompt: "Warm acoustic guitar harmonics, mellow keys, subtle tape texture, compact drums, and a bright but relaxed early-morning atmosphere"
  },
  {
    title: "Sil\xEAncio Depois do E-mail",
    mood: "melancholic",
    bpm: 66,
    prompt: "Felt piano, low cello textures, restrained vinyl noise, slow brushed percussion, and a comforting harmonic resolution"
  }
];
function requestedCount() {
  const value = Number.parseInt(process.argv[2] || "3", 10);
  if (!Number.isInteger(value) || value < 1 || value > DIRECTIONS.length) {
    throw new Error(`Informe uma quantidade entre 1 e ${DIRECTIONS.length}.`);
  }
  return value;
}
async function main() {
  const count = requestedCount();
  const batchDate = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  for (const direction of DIRECTIONS.slice(0, count)) {
    const result = await MusicGenerationService.requestGeneration({
      source: "EDITORIAL",
      prompt: direction.prompt,
      title: direction.title,
      mood: direction.mood,
      bpm: direction.bpm,
      locale: "pt",
      idempotencyKey: `production-launch-${batchDate}-${direction.bpm}`
    });
    if (!result.accepted) {
      throw new Error(`${direction.title}: ${result.code} \u2014 ${result.message}`);
    }
    console.log(`QUEUED ${result.generationId} ${result.title}`);
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(async () => {
  await closeMusicGenerationQueue();
  await prisma.$disconnect();
});
