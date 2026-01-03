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

// scripts/import-sql.ts
var import_client = require("@prisma/client");
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var prisma = new import_client.PrismaClient();
function makeUpsert(statement) {
  if (statement.includes("ON CONFLICT")) {
    return statement;
  }
  return statement + " ON CONFLICT DO NOTHING";
}
async function importSQL() {
  const sqlFile = process.argv[2] || "tracks_dump.sql";
  const sqlPath = path.join(process.cwd(), sqlFile);
  if (!fs.existsSync(sqlPath)) {
    console.error(`\u274C Arquivo n\xE3o encontrado: ${sqlPath}`);
    process.exit(1);
  }
  console.log(`\u{1F4C2} Lendo arquivo: ${sqlPath}`);
  const sqlContent = fs.readFileSync(sqlPath, "utf-8");
  const statements = sqlContent.split(";").map((s) => s.trim()).filter((s) => s.length > 0 && s.startsWith("INSERT")).map(makeUpsert);
  console.log(`\u{1F4CA} Encontrados ${statements.length} comandos INSERT (com ON CONFLICT DO NOTHING)`);
  let success = 0;
  let skipped = 0;
  let errors = 0;
  for (const statement of statements) {
    try {
      const result = await prisma.$executeRawUnsafe(statement + ";");
      if (result === 0) {
        skipped++;
      } else {
        success++;
      }
      if ((success + skipped) % 100 === 0) {
        console.log(`\u2705 ${success} importados, \u23E9 ${skipped} j\xE1 existentes...`);
      }
    } catch (error) {
      const pgCode = error.code || error.meta?.code;
      const message = error.message || "";
      const metaMessage = error.meta?.message || "";
      const fullError = `${message} ${metaMessage}`;
      const isDuplicate = pgCode === "23505" || pgCode === "P2002" || fullError.includes("23505") || fullError.includes("duplicate") || fullError.includes("unique") || fullError.includes("already exists");
      if (isDuplicate) {
        skipped++;
      } else {
        console.error(`\u274C Erro: ${fullError}`);
        errors++;
      }
    }
  }
  console.log(`
\u{1F389} Importa\xE7\xE3o conclu\xEDda!`);
  console.log(`   \u2705 Novos: ${success}`);
  console.log(`   \u23E9 J\xE1 existentes: ${skipped}`);
  console.log(`   \u274C Erros: ${errors}`);
}
importSQL().catch((e) => {
  console.error("\u274C Erro fatal:", e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
