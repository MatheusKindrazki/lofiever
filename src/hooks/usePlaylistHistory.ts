import { useQuery } from '@tanstack/react-query';

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

async function fetchPlaylistHistory(selectedDate: Date): Promise<HistoryData> {
    // Use local date string (YYYY-MM-DD)
    const dateStr = selectedDate.toLocaleDateString('en-CA');
    // Get timezone offset in minutes
    const timezoneOffset = new Date().getTimezoneOffset();

    const response = await fetch(`/api/playlist/history?date=${dateStr}&timezoneOffset=${timezoneOffset}`);

    if (!response.ok) {
        throw new Error('Failed to fetch history');
    }

    return response.json();
}

/**
 * Hook to fetch and manage playlist history for a specific date
 */
export function usePlaylistHistory(selectedDate: Date) {
    const { data, isLoading, error } = useQuery<HistoryData>({
        queryKey: ['playlist', 'history', selectedDate.toLocaleDateString('en-CA')],
        queryFn: () => fetchPlaylistHistory(selectedDate),
        staleTime: 60 * 1000, // 1 minute
        refetchOnWindowFocus: false, // History doesn't change often
    });

    return {
        history: data?.tracks || [],
        stats: data?.stats || null,
        isLoading,
        error: error?.message || null,
    };
}

