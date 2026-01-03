import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';

const prisma = new PrismaClient();

// Transform INSERT to INSERT ... ON CONFLICT DO NOTHING for idempotent imports
function makeUpsert(statement: string): string {
  // Already has ON CONFLICT
  if (statement.includes('ON CONFLICT')) {
    return statement;
  }

  // Add ON CONFLICT DO NOTHING to make it idempotent
  return statement + ' ON CONFLICT DO NOTHING';
}

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
    .filter(s => s.length > 0 && s.startsWith('INSERT'))
    .map(makeUpsert); // Convert to upserts

  console.log(`📊 Encontrados ${statements.length} comandos INSERT (com ON CONFLICT DO NOTHING)`);

  let success = 0;
  let skipped = 0;
  let errors = 0;

  for (const statement of statements) {
    try {
      const result = await prisma.$executeRawUnsafe(statement + ';');
      if (result === 0) {
        skipped++;
      } else {
        success++;
      }
      if ((success + skipped) % 100 === 0) {
        console.log(`✅ ${success} importados, ⏩ ${skipped} já existentes...`);
      }
    } catch (error: any) {
      // Prisma wraps PostgreSQL errors - check all possible locations
      const pgCode = error.code || error.meta?.code;
      const message = error.message || '';
      const metaMessage = error.meta?.message || '';
      const fullError = `${message} ${metaMessage}`;

      // 23505 = unique_violation, P2002 = Prisma unique constraint
      const isDuplicate =
        pgCode === '23505' ||
        pgCode === 'P2002' ||
        fullError.includes('23505') ||
        fullError.includes('duplicate') ||
        fullError.includes('unique') ||
        fullError.includes('already exists');

      if (isDuplicate) {
        skipped++;
      } else {
        console.error(`❌ Erro: ${fullError}`);
        errors++;
      }
    }
  }

  console.log(`\n🎉 Importação concluída!`);
  console.log(`   ✅ Novos: ${success}`);
  console.log(`   ⏩ Já existentes: ${skipped}`);
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
