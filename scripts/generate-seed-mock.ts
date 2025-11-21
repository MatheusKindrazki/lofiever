import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const prisma = new PrismaClient();

/**
 * Este script lê a tabela 'Track' do banco de dados atual
 * e gera um arquivo de mock que pode ser usado para semear
 * o banco de dados em outros ambientes ou como um backup de dados de faixa.
 */
async function generateMock() {
  console.log('🔍 Lendo todas as faixas do banco de dados...');

  const tracks = await prisma.track.findMany({
    orderBy: {
      createdAt: 'asc',
    },
  });

  if (tracks.length === 0) {
    console.log('⚠️ Nenhuma faixa encontrada no banco de dados. Nenhum arquivo de mock gerado.');
    return;
  }

  console.log(`✅ Encontradas ${tracks.length} faixas.`);

  // Formata os dados para serem um array de objetos TypeScript
  const mockDataContent = `
// Este arquivo foi gerado automaticamente por 'scripts/generate-seed-mock.ts'
// Contém um snapshot da tabela 'Track' do seu banco de dados.

export const mockTracks = ${JSON.stringify(
  tracks.map(track => ({
    // Omitimos campos gerados automaticamente como id, createdAt, etc.
    title: track.title,
    artist: track.artist,
    sourceType: track.sourceType,
    sourceId: track.sourceId,
    artworkKey: track.artworkKey,
    duration: track.duration,
    bpm: track.bpm,
    mood: track.mood,
  })),
  null,
  2
)};
`;

  const outputPath = path.join(process.cwd(), 'prisma', 'seed-mock-data.ts');
  await fs.writeFile(outputPath, mockDataContent.trim());

  console.log(`🎉 Arquivo de mock gerado com sucesso em: ${outputPath}`);
}

generateMock()
  .catch((e) => {
    console.error('❌ Erro ao gerar o arquivo de mock:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
