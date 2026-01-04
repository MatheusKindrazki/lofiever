import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleApiError } from '@/lib/api-utils';
import type { Prisma } from '@prisma/client';

// GET - Obter lista de faixas
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit') || '20');
    const offset = Number(searchParams.get('offset') || '0');
    const search = searchParams.get('search');

    // Construir o filtro baseado no termo de busca
    const filter: Prisma.TrackWhereInput = search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' as const } },
            { artist: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    
    // Buscar faixas com paginação
    const tracks = await prisma.track.findMany({
      where: filter,
      take: Math.min(limit, 100), // Limitar a 100 registros
      skip: offset,
      orderBy: { lastPlayed: 'desc' },
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
    
    // Criar nova faixa
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
    });
    
    return NextResponse.json(track, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
} 