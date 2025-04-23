import { NextResponse } from 'next/server';
import { DatabaseService } from '@/services/database';
import { handleApiError } from '@/lib/api-utils';

// GET - Obter estatísticas do stream
export async function GET(): Promise<NextResponse> {
  try {
    const stats = await DatabaseService.getStreamStats();
    
    // Formatar a resposta
    const formattedStats = {
      currentListeners: stats.currentListeners,
      totalTracksPlayed: stats.totalTracksPlayed,
      uniqueTracks: stats.uniqueTracks,
      daysActive: stats.daysActive,
      recentHistory: stats.recentHistory.map(record => ({
        id: record.id,
        trackId: record.trackId,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
        listenersPeak: record.listenersPeak,
        version: record.version,
      })),
    };
    
    return NextResponse.json(formattedStats, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
} 