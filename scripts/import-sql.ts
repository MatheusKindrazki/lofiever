import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';

const prisma = new PrismaClient();

async function importSQL() {
  const sqlFile = process.argv[2] || 'tracks_dump.sql';
  const sqlPath = path.join(process.cwd(), sqlFile);

  if (!fs.existsSync(sqlPath)) {
    console.error(`❌ Arquivo não encontrado: ${sqlPath}`);
    process.exit(1);
  }

  console.log(`📂 Lendo arquivo: ${sqlPath}`);
  const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

  // Split by semicolon and filter empty statements
  const statements = sqlContent
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.startsWith('INSERT'));

  console.log(`📊 Encontrados ${statements.length} comandos INSERT`);

  let success = 0;
  let errors = 0;

  for (const statement of statements) {
    try {
      await prisma.$executeRawUnsafe(statement + ';');
      success++;
      if (success % 100 === 0) {
        console.log(`✅ ${success} registros importados...`);
      }
    } catch (error: any) {
      // Ignore duplicate key errors
      if (error.code === 'P2002' || error.message?.includes('duplicate') || error.message?.includes('unique')) {
        console.log(`⏩ Registro já existe, pulando...`);
      } else {
        console.error(`❌ Erro: ${error.message}`);
        errors++;
      }
    }
  }

  console.log(`\n🎉 Importação concluída!`);
  console.log(`   ✅ Sucesso: ${success}`);
  console.log(`   ❌ Erros: ${errors}`);
}

importSQL()
  .catch((e) => {
    console.error('❌ Erro fatal:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
