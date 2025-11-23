import { useQuery } from '@tanstack/react-query';

export interface QueueTrack {
    id: string;
    title: string;
    artist: string;
    mood?: string;
    duration: number;
    addedBy?: string;
    playedAt?: Date | string;
}

export interface PlaylistQueueData {
    current: QueueTrack | null;
    upcoming: QueueTrack[];
    history: QueueTrack[];
    position: number;
    totalTracks: number;
}

async function fetchPlaylistQueue(): Promise<PlaylistQueueData> {
    const response = await fetch('/api/playlist/queue');
    if (!response.ok) {
        throw new Error('Failed to fetch playlist queue');
    }
    return response.json();
}

export function usePlaylistQueue() {
    return useQuery<PlaylistQueueData>({
        queryKey: ['playlist', 'queue'],
        queryFn: fetchPlaylistQueue,
        staleTime: 20 * 1000, // 20 seconds
        refetchInterval: 30 * 1000, // 30 seconds
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
    });
}
