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

// scripts/generate-seed-mock.ts
var import_client = require("@prisma/client");
var fs = __toESM(require("node:fs/promises"));
var path = __toESM(require("node:path"));
var prisma = new import_client.PrismaClient();
async function generateMock() {
  console.log("\u{1F50D} Lendo todas as faixas do banco de dados...");
  const tracks = await prisma.track.findMany({
    orderBy: {
      createdAt: "asc"
    }
  });
  if (tracks.length === 0) {
    console.log("\u26A0\uFE0F Nenhuma faixa encontrada no banco de dados. Nenhum arquivo de mock gerado.");
    return;
  }
  console.log(`\u2705 Encontradas ${tracks.length} faixas.`);
  const mockDataContent = `
// Este arquivo foi gerado automaticamente por 'scripts/generate-seed-mock.ts'
// Cont\xE9m um snapshot da tabela 'Track' do seu banco de dados.

export const mockTracks = ${JSON.stringify(
    tracks.map((track) => ({
      // Omitimos campos gerados automaticamente como id, createdAt, etc.
      title: track.title,
      artist: track.artist,
      sourceType: track.sourceType,
      sourceId: track.sourceId,
      artworkKey: track.artworkKey,
      duration: track.duration,
      bpm: track.bpm,
      mood: track.mood
    })),
    null,
    2
  )};
`;
  const outputPath = path.join(process.cwd(), "prisma", "seed-mock-data.ts");
  await fs.writeFile(outputPath, mockDataContent.trim());
  console.log(`\u{1F389} Arquivo de mock gerado com sucesso em: ${outputPath}`);
}
generateMock().catch((e) => {
  console.error("\u274C Erro ao gerar o arquivo de mock:", e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
