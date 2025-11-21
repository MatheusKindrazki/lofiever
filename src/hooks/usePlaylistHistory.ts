import { useState, useEffect } from 'react';

interface HistoryTrack {
    id: string;
    title: string;
    artist: string;
    mood?: string;
    duration: number;
    playedAt: Date | string;
}

interface HistoryStats {
    total: number;
    uniqueTracks: number;
    totalDuration: number;
}

interface HistoryData {
    date: string;
    tracks: HistoryTrack[];
    stats: HistoryStats;
}

/**
 * Hook to fetch and manage playlist history for a specific date
 */
export function usePlaylistHistory(selectedDate: Date) {
    const [history, setHistory] = useState<HistoryTrack[]>([]);
    const [stats, setStats] = useState<HistoryStats | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchHistory = async () => {
            setIsLoading(true);
            setError(null);

            try {
                // Use local date string (YYYY-MM-DD)
                const dateStr = selectedDate.toLocaleDateString('en-CA');
                // Get timezone offset in minutes
                const timezoneOffset = new Date().getTimezoneOffset();

                const response = await fetch(`/api/playlist/history?date=${dateStr}&timezoneOffset=${timezoneOffset}`);

                if (!response.ok) {
                    throw new Error('Failed to fetch history');
                }

                const data: HistoryData = await response.json();

                setHistory(data.tracks);
                setStats(data.stats);
            } catch (err) {
                console.error('Error fetching history:', err);
                setError(err instanceof Error ? err.message : 'Unknown error');
                setHistory([]);
                setStats(null);
            } finally {
                setIsLoading(false);
            }
        };

        fetchHistory();
    }, [selectedDate]);

    return {
        history,
        stats,
        isLoading,
        error
    };
}
