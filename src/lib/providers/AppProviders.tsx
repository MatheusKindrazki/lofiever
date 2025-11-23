'use client';

import { SessionProvider } from "next-auth/react";
import ReactQueryProvider from "./ReactQueryProvider";
import React from "react";
import { usePlaylistSync } from "@/hooks/usePlaylistSync";

// Wrapper component to use hooks inside providers
function PlaylistSyncProvider({ children }: { children: React.ReactNode }) {
    usePlaylistSync(); // This hook listens to WebSocket and invalidates queries
    return <>{children}</>;
}

export default function AppProviders({
    children
}: {
    children: React.ReactNode;
}) {
    return (
        <SessionProvider>
            <ReactQueryProvider>
                <PlaylistSyncProvider>
                    {children}
                </PlaylistSyncProvider>
            </ReactQueryProvider>
        </SessionProvider>
    );
}

