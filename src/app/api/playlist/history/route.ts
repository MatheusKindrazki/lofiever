import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const dateParam = searchParams.get('date');
        const limit = parseInt(searchParams.get('limit') || '100', 10);
        const offset = parseInt(searchParams.get('offset') || '0', 10);

        const timezoneOffset = parseInt(searchParams.get('timezoneOffset') || '0', 10);

        // Parse date or use today
        const targetDate = dateParam ? new Date(dateParam) : new Date();

        // Create dates in UTC but adjusted for the user's timezone
        // If user is in UTC-3 (offset 180), and wants 2025-11-21:
        // Start: 2025-11-21T00:00:00 Local -> 2025-11-21T03:00:00 UTC
        // End: 2025-11-21T23:59:59.999 Local -> 2025-11-22T02:59:59.999 UTC

        const startOfDay = new Date(targetDate);
        startOfDay.setUTCHours(0, 0, 0, 0);
        startOfDay.setMinutes(startOfDay.getMinutes() + timezoneOffset);

        const endOfDay = new Date(targetDate);
        endOfDay.setUTCHours(23, 59, 59, 999);
        endOfDay.setMinutes(endOfDay.getMinutes() + timezoneOffset);

        console.log(`[History API] Fetching history for ${startOfDay.toISOString().split('T')[0]}`);

        // Query playback history for the day
        const [tracks, total] = await Promise.all([
            prisma.playbackHistory.findMany({
                where: {
                    startedAt: {
                        gte: startOfDay,
                        lte: endOfDay,
                    },
                },
                include: {
                    track: true,
                },
                orderBy: { startedAt: 'desc' },
                take: limit,
                skip: offset,
            }),
            prisma.playbackHistory.count({
                where: {
                    startedAt: {
                        gte: startOfDay,
                        lte: endOfDay
                    },
                },
            }),
        ]);

        // Get unique track count
        const uniqueTracksQuery = await prisma.playbackHistory.groupBy({
            by: ['trackId'],
            where: {
                startedAt: {
                    gte: startOfDay,
                    lte: endOfDay
                },
            },
        });
        const uniqueCount = uniqueTracksQuery.length;

        // Calculate total duration
        const totalDuration = tracks.reduce((sum, ph) => sum + (ph.track?.duration || 0), 0);

        console.log(`[History API] Found ${total} tracks (${uniqueCount} unique) for the day`);

        // Format response
        return NextResponse.json({
            date: targetDate.toISOString().split('T')[0],
            tracks: tracks.map(ph => ({
                id: ph.track.id,
                title: ph.track.title,
                artist: ph.track.artist,
                mood: ph.track.mood,
                duration: ph.track.duration,
                playedAt: ph.startedAt,
            })),
            stats: {
                total,
                uniqueTracks: uniqueCount,
                totalDuration,
            },
        });
    } catch (error) {
        console.error('[History API] Error fetching history:', error);
        return NextResponse.json(
            { error: 'Failed to fetch history' },
            { status: 500 }
        );
    }
}
