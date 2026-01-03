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
async function importSQL() {
  const sqlFile = process.argv[2] || "tracks_dump.sql";
  const sqlPath = path.join(process.cwd(), sqlFile);
  if (!fs.existsSync(sqlPath)) {
    console.error(`\u274C Arquivo n\xE3o encontrado: ${sqlPath}`);
    process.exit(1);
  }
  console.log(`\u{1F4C2} Lendo arquivo: ${sqlPath}`);
  const sqlContent = fs.readFileSync(sqlPath, "utf-8");
  const statements = sqlContent.split(";").map((s) => s.trim()).filter((s) => s.length > 0 && s.startsWith("INSERT"));
  console.log(`\u{1F4CA} Encontrados ${statements.length} comandos INSERT`);
  let success = 0;
  let errors = 0;
  for (const statement of statements) {
    try {
      await prisma.$executeRawUnsafe(statement + ";");
      success++;
      if (success % 100 === 0) {
        console.log(`\u2705 ${success} registros importados...`);
      }
    } catch (error) {
      if (error.code === "P2002" || error.message?.includes("duplicate") || error.message?.includes("unique")) {
        console.log(`\u23E9 Registro j\xE1 existe, pulando...`);
      } else {
        console.error(`\u274C Erro: ${error.message}`);
        errors++;
      }
    }
  }
  console.log(`
\u{1F389} Importa\xE7\xE3o conclu\xEDda!`);
  console.log(`   \u2705 Sucesso: ${success}`);
  console.log(`   \u274C Erros: ${errors}`);
}
importSQL().catch((e) => {
  console.error("\u274C Erro fatal:", e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
