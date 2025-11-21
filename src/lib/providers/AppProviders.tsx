'use client';

import { SessionProvider } from "next-auth/react";
import ReactQueryProvider from "./ReactQueryProvider";
import React from "react";

export default function AppProviders({
    children
}: {
    children: React.ReactNode;
}) {
    return (
        <SessionProvider>
            <ReactQueryProvider>
                {children}
            </ReactQueryProvider>
        </SessionProvider>
    );
}
