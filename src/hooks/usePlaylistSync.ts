import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket } from '@/lib/socket/client';
import { SOCKET_EVENTS } from '@/lib/socket/types';

/**
 * Hook that listens to WebSocket events and invalidates React Query cache accordingly.
 * This ensures playlist data stays in sync with real-time updates from the server.
 */
export function usePlaylistSync() {
    const queryClient = useQueryClient();
    const { socket } = useSocket();

    useEffect(() => {
        if (!socket) return;

        // Track change event - invalidate queue to show new current track
        const onTrackChange = () => {
            console.log('[PlaylistSync] Track changed, invalidating queue cache');
            queryClient.invalidateQueries({ queryKey: ['playlist', 'queue'] });
        };

        // Playlist update event - invalidate queue to show new upcoming tracks
        const onPlaylistUpdate = () => {
            console.log('[PlaylistSync] Playlist updated, invalidating queue cache');
            queryClient.invalidateQueries({ queryKey: ['playlist', 'queue'] });
        };

        // DJ announcement event - might be a user request, invalidate queue
        const onDJAnnouncement = () => {
            console.log('[PlaylistSync] DJ announcement, invalidating queue cache');
            queryClient.invalidateQueries({ queryKey: ['playlist', 'queue'] });
        };

        // Register event listeners
        socket.on(SOCKET_EVENTS.TRACK_CHANGE, onTrackChange);
        socket.on(SOCKET_EVENTS.PLAYLIST_UPDATE, onPlaylistUpdate);
        socket.on(SOCKET_EVENTS.DJ_ANNOUNCEMENT, onDJAnnouncement);

        // Cleanup
        return () => {
            socket.off(SOCKET_EVENTS.TRACK_CHANGE, onTrackChange);
            socket.off(SOCKET_EVENTS.PLAYLIST_UPDATE, onPlaylistUpdate);
            socket.off(SOCKET_EVENTS.DJ_ANNOUNCEMENT, onDJAnnouncement);
        };
    }, [socket, queryClient]);
}
