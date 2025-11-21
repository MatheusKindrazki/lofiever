import { PrismaClient, Track } from '@prisma/client';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as mm from 'music-metadata';
import { R2Lib } from '../src/lib/r2';
import { config } from '../src/lib/config';

type SeedMode = 'dev' | 'prod' | 'local-prod';

const prisma = new PrismaClient();
const musicDir = path.join(process.cwd(), 'public', 'music');

async function seed(mode: SeedMode) {
  if (mode === 'dev') {
    console.log('🌱 Iniciando seed em modo de desenvolvimento (limpando o banco)...');
    await prisma.playlistTrack.deleteMany();
    await prisma.playlist.deleteMany();
    await prisma.playbackHistory.deleteMany();
    await prisma.feedback.deleteMany();
    await prisma.chatMessage.deleteMany();
    await prisma.track.deleteMany();
    console.log('🗑️  Dados existentes foram limpos.');
  } else {
    console.log(`🌱 Iniciando seed em modo '${mode}' (apenas adicionando novas faixas)...`);
  }

  const newTracks = await processMusicFiles(mode);

  if (newTracks.length === 0) {
    console.log('✅ Nenhuma nova faixa para adicionar.');
    return;
  }

  if (mode === 'dev') {
    const playlist = await prisma.playlist.create({
      data: {
        version: 1,
        active: true,
        tracks: { create: newTracks.map((track, index) => ({ trackId: track.id, position: index })) },
      },
      include: { tracks: true },
    });
    console.log(`🎵 Playlist de desenvolvimento criada com ${playlist.tracks.length} faixas.`);
  }

  console.log(`🎉 Seed concluído! ${newTracks.length} novas faixas foram processadas.`);
}

async function processMusicFiles(mode: SeedMode): Promise<Track[]> {
  const newTracks: Track[] = [];
  const files = await fs.readdir(musicDir);

  for (const file of files) {
    const filePath = path.join(musicDir, file);
    if ((await fs.stat(filePath)).isDirectory()) continue;

    try {
      console.log(`🎵 Processando ${file}...`);
      const metadata = await mm.parseFile(filePath);
      const { common, format } = metadata;
      if (!format.duration) continue;

      const title = common.title || path.parse(file).name;
      const artist = common.artist || 'Artista Desconhecido';

      const existingTrack = await prisma.track.findFirst({ where: { title, artist } });
      if (existingTrack) {
        console.log(`⏩ Pulando "${title} - ${artist}", já existe.`);
        continue;
      }

      let sourceId = file;
      let sourceType = 'local';
      let artworkKey: string | null = null;
      const trackId = crypto.randomUUID();

      if (mode === 'prod') {
        sourceType = 's3';
        const musicKey = `music/${trackId}-${file}`;
        console.log(`⏫ Fazendo upload de ${musicKey} para o R2...`);
        sourceId = await R2Lib.uploadFile(filePath, musicKey);

        if (common.picture?.[0]) {
          const picture = common.picture[0];
          artworkKey = `covers/${trackId}.jpg`;
          console.log(`⏫ Fazendo upload de ${artworkKey} para o R2...`);
          await R2Lib.uploadBuffer(Buffer.from(picture.data), artworkKey, picture.format);
        }
      } else if (mode === 'local-prod') {
        // Simula a estrutura de produção, mas sem fazer upload.
        sourceType = 's3';
        sourceId = `music/mock/${file}`; // Placeholder
        artworkKey = `covers/mock/${trackId}.jpg`; // Placeholder
        console.log(`📦 Criando mock de produção para ${file}.`);
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
        mood: common.genre?.[0] || null,
      };
      
      const newTrack = await prisma.track.create({ data: trackData });
      newTracks.push(newTrack);
      console.log(`✍️  Faixa criada no banco: ${newTrack.title}`);

    } catch (error) {
      console.error(`❌ Erro ao processar ${file}:`, error);
    }
  }
  return newTracks;
}

async function main() {
  const args = process.argv.slice(2);
  const modeArg = args.find(arg => arg.startsWith('--mode='));
  const mode = modeArg ? modeArg.split('=')[1] as SeedMode : 'dev';

  if (!['dev', 'prod', 'local-prod'].includes(mode)) {
    console.error("Modo inválido. Use '--mode=dev', '--mode=prod', ou '--mode=local-prod'.");
    process.exit(1);
  }
  
  if (mode === 'prod' && !config.r2.bucket) {
    console.error("Erro: O modo 'prod' requer as variáveis de ambiente do R2.");
    process.exit(1);
  }

  await seed(mode);
}

main()
  .catch((e) => {
    console.error('❌ Erro fatal no script de seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });