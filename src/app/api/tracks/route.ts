import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleApiError } from '@/lib/api-utils';
import { getSourceTypeFilter } from '@/services/playlist/source-policy';
import type { Prisma } from '@prisma/client';

// Campos seguros para enviar ao cliente. Nunca serializa `sourceId`
// (URL/path/chave R2) nem `artworkKey` (chave R2 da capa) — chaves internas
// de armazenamento não devem vazar para clientes (mesmo anônimos).
const CATALOG_TRACK_SELECT = {
  id: true,
  title: true,
  artist: true,
  sourceType: true,
  duration: true,
  bpm: true,
  mood: true,
} satisfies Prisma.TrackSelect;

// GET - Obter lista de faixas
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit') || '20');
    const offset = Number(searchParams.get('offset') || '0');
    const search = searchParams.get('search');
    // Restringe a busca às fontes tocáveis (r2/s3/local; youtube só quando
    // habilitado) para que a UI nunca ofereça uma faixa inalcançável.
    const playableFilter = getSourceTypeFilter();

    // Construir o filtro baseado no termo de busca, sempre combinado com o
    // whitelist de fontes tocáveis.
    const filter: Prisma.TrackWhereInput = search
      ? {
          AND: [
            playableFilter,
            {
              OR: [
                { title: { contains: search, mode: 'insensitive' as const } },
                { artist: { contains: search, mode: 'insensitive' as const } },
                { mood: { contains: search, mode: 'insensitive' as const } },
              ],
            },
          ],
        }
      : playableFilter;

    // Buscar faixas com paginação (apenas campos seguros para o cliente)
    const tracks = await prisma.track.findMany({
      where: filter,
      take: Math.min(limit, 100), // Limitar a 100 registros
      skip: offset,
      orderBy: { lastPlayed: 'desc' },
      select: CATALOG_TRACK_SELECT,
    });
    
    // Contar o total de registros
    const total = await prisma.track.count({ where: filter });
    
    return NextResponse.json(
      {
        tracks,
        meta: {
          total,
          limit,
          offset,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

// POST - Criar uma nova faixa
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const data = await request.json();
    
    // Validar campos obrigatórios
    const requiredFields = ['title', 'artist', 'sourceType', 'sourceId', 'duration'];
    for (const field of requiredFields) {
      if (!data[field]) {
        return NextResponse.json(
          { error: `Field '${field}' is required`, code: 'MISSING_FIELD' },
          { status: 400 }
        );
      }
    }
    
    // Verificar se a faixa já existe
    const existing = await prisma.track.findFirst({
      where: {
        sourceType: data.sourceType,
        sourceId: data.sourceId,
      },
    });
    
    if (existing) {
      return NextResponse.json(
        { error: 'Track already exists', code: 'DUPLICATE', trackId: existing.id },
        { status: 409 }
      );
    }
    
    // Criar nova faixa (resposta sem campos internos de armazenamento)
    const track = await prisma.track.create({
      data: {
        title: data.title,
        artist: data.artist,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        duration: data.duration,
        bpm: data.bpm || null,
        mood: data.mood || null,
      },
      select: CATALOG_TRACK_SELECT,
    });

    return NextResponse.json(track, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
