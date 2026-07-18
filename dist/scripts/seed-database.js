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

// scripts/seed-database.ts
var import_client = require("@prisma/client");
var fs2 = __toESM(require("node:fs/promises"));
var path = __toESM(require("node:path"));
var mm = __toESM(require("music-metadata"));

// src/lib/r2.ts
var import_client_s3 = require("@aws-sdk/client-s3");
var import_s3_request_presigner = require("@aws-sdk/s3-request-presigner");

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
var PUBLIC_APP_URL = pickFirstValidUrl(process.env.NEXT_PUBLIC_APP_URL, "http://localhost:3000");
var INTERNAL_APP_URL = pickFirstValidUrl(process.env.APP_INTERNAL_URL, PUBLIC_APP_URL);
function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function positiveNumber(value, fallback) {
  const parsed = Number.parseFloat(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
var config = {
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

// src/lib/r2.ts
var fs = __toESM(require("node:fs/promises"));
var import_mime_types = require("mime-types");
var R2_ENABLED = config.r2.endpoint && config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.bucket;
if (!R2_ENABLED) {
  console.warn(
    "\u26A0\uFE0F  Configura\xE7\xF5es do Cloudflare R2 n\xE3o est\xE3o completas. Fun\xE7\xF5es do R2 ser\xE3o desativadas."
  );
}
var R2 = new import_client_s3.S3Client({
  region: "auto",
  endpoint: config.r2.endpoint,
  // Usamos o endpoint original do R2 para a conexão
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey
  },
  forcePathStyle: true
  // Mantemos o path style para evitar subdomínios
});
function getR2PublicUrl(key) {
  if (!config.r2.publicUrl) {
    console.warn("[R2] No public URL configured, returning key as path");
    return `/${key}`;
  }
  const oldUrl = `${config.r2.endpoint}/${config.r2.bucket}`;
  return key.replace(oldUrl, config.r2.publicUrl);
}
var R2Lib = {
  async uploadFile(localPath, key) {
    if (!R2_ENABLED) throw new Error("R2 n\xE3o est\xE1 configurado.");
    const fileContent = await fs.readFile(localPath);
    const contentType = (0, import_mime_types.lookup)(localPath) || "application/octet-stream";
    const command = new import_client_s3.PutObjectCommand({
      Bucket: config.r2.bucket,
      Key: key,
      Body: fileContent,
      ContentType: contentType
    });
    await R2.send(command);
    return key;
  },
  async uploadBuffer(buffer, key, contentType) {
    if (!R2_ENABLED) throw new Error("R2 n\xE3o est\xE1 configurado.");
    const command = new import_client_s3.PutObjectCommand({
      Bucket: config.r2.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType
    });
    await R2.send(command);
    return key;
  },
  /**
   * Gera uma URL pré-assinada para acesso temporário a um objeto privado.
   * A URL aponta diretamente para o R2 endpoint para garantir que a assinatura seja válida.
   */
  async getPresignedUrl(key, expiresIn = 3600) {
    if (!R2_ENABLED) throw new Error("R2 n\xE3o est\xE1 configurado.");
    const command = new import_client_s3.GetObjectCommand({
      Bucket: config.r2.bucket,
      Key: key
    });
    const signedUrl = await (0, import_s3_request_presigner.getSignedUrl)(R2, command, { expiresIn });
    return getR2PublicUrl(signedUrl);
  }
};

// scripts/seed-database.ts
var prisma = new import_client.PrismaClient();
var musicDir = path.join(process.cwd(), "public", "music");
async function seed(mode) {
  if (mode === "dev") {
    console.log("\u{1F331} Iniciando seed em modo de desenvolvimento (limpando o banco)...");
    await prisma.playlistTrack.deleteMany();
    await prisma.playlist.deleteMany();
    await prisma.playbackHistory.deleteMany();
    await prisma.feedback.deleteMany();
    await prisma.chatMessage.deleteMany();
    await prisma.track.deleteMany();
    console.log("\u{1F5D1}\uFE0F  Dados existentes foram limpos.");
  } else {
    console.log(`\u{1F331} Iniciando seed em modo '${mode}' (apenas adicionando novas faixas)...`);
  }
  const newTracks = await processMusicFiles(mode);
  if (newTracks.length === 0) {
    console.log("\u2705 Nenhuma nova faixa para adicionar.");
    return;
  }
  if (mode === "dev") {
    const playlist = await prisma.playlist.create({
      data: {
        version: 1,
        active: true,
        tracks: { create: newTracks.map((track, index) => ({ trackId: track.id, position: index })) }
      },
      include: { tracks: true }
    });
    console.log(`\u{1F3B5} Playlist de desenvolvimento criada com ${playlist.tracks.length} faixas.`);
  }
  console.log(`\u{1F389} Seed conclu\xEDdo! ${newTracks.length} novas faixas foram processadas.`);
}
async function processMusicFiles(mode) {
  const newTracks = [];
  const files = await fs2.readdir(musicDir);
  for (const file of files) {
    const filePath = path.join(musicDir, file);
    if ((await fs2.stat(filePath)).isDirectory()) continue;
    try {
      console.log(`\u{1F3B5} Processando ${file}...`);
      const metadata = await mm.parseFile(filePath);
      const { common, format } = metadata;
      if (!format.duration) continue;
      const title = common.title || path.parse(file).name;
      const artist = common.artist || "Artista Desconhecido";
      const existingTrack = await prisma.track.findFirst({ where: { title, artist } });
      if (existingTrack) {
        console.log(`\u23E9 Pulando "${title} - ${artist}", j\xE1 existe.`);
        continue;
      }
      let sourceId = file;
      let sourceType = "local";
      let artworkKey = null;
      const trackId = crypto.randomUUID();
      if (mode === "prod") {
        sourceType = "s3";
        const musicKey = `music/${trackId}-${file}`;
        console.log(`\u23EB Fazendo upload de ${musicKey} para o R2...`);
        sourceId = await R2Lib.uploadFile(filePath, musicKey);
        if (common.picture?.[0]) {
          const picture = common.picture[0];
          artworkKey = `covers/${trackId}.jpg`;
          console.log(`\u23EB Fazendo upload de ${artworkKey} para o R2...`);
          await R2Lib.uploadBuffer(Buffer.from(picture.data), artworkKey, picture.format);
        }
      } else if (mode === "local-prod") {
        sourceType = "s3";
        sourceId = `music/mock/${file}`;
        artworkKey = `covers/mock/${trackId}.jpg`;
        console.log(`\u{1F4E6} Criando mock de produ\xE7\xE3o para ${file}.`);
      }
      const trackData = {
        id: trackId,
        title,
        artist,
        sourceType,
        sourceId,
        artworkKey,
        duration: Math.round(format.duration),
        bpm: common.bpm || null,
        mood: common.genre?.[0] || null
      };
      const newTrack = await prisma.track.create({ data: trackData });
      newTracks.push(newTrack);
      console.log(`\u270D\uFE0F  Faixa criada no banco: ${newTrack.title}`);
    } catch (error) {
      console.error(`\u274C Erro ao processar ${file}:`, error);
    }
  }
  return newTracks;
}
async function main() {
  const args = process.argv.slice(2);
  const modeArg = args.find((arg) => arg.startsWith("--mode="));
  const mode = modeArg ? modeArg.split("=")[1] : "dev";
  if (!["dev", "prod", "local-prod"].includes(mode)) {
    console.error("Modo inv\xE1lido. Use '--mode=dev', '--mode=prod', ou '--mode=local-prod'.");
    process.exit(1);
  }
  if (mode === "prod" && !config.r2.bucket) {
    console.error("Erro: O modo 'prod' requer as vari\xE1veis de ambiente do R2.");
    process.exit(1);
  }
  await seed(mode);
}
main().catch((e) => {
  console.error("\u274C Erro fatal no script de seed:", e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
