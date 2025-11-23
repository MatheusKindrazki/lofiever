import { useState, useEffect } from 'react';

interface UserSession {
    userId: string;
    username: string;
    token: string;
    isGuest: boolean;
}

const SESSION_KEY = 'lofiever:session';

export function useUserSession() {
    const [session, setSessionState] = useState<UserSession | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Load session from localStorage on mount
    useEffect(() => {
        if (typeof window === 'undefined') return;

        try {
            const stored = localStorage.getItem(SESSION_KEY);
            if (stored) {
                const parsed = JSON.parse(stored) as UserSession;
                setSessionState(parsed);
            }
        } catch (error) {
            console.error('Failed to load user session:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Save session to localStorage
    const setSession = (newSession: UserSession) => {
        setSessionState(newSession);
        try {
            localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
        } catch (error) {
            console.error('Failed to save user session:', error);
        }
    };

    // Clear session
    const clearSession = () => {
        setSessionState(null);
        try {
            localStorage.removeItem(SESSION_KEY);
        } catch (error) {
            console.error('Failed to clear user session:', error);
        }
    };

    // Login function (calls API and saves session)
    const loginAsGuest = async (username?: string) => {
        try {
            const response = await fetch('/api/auth/guest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username }),
            });

            if (!response.ok) throw new Error('Login failed');

            const data = await response.json();

            const newSession: UserSession = {
                userId: data.user.id,
                username: data.user.name,
                token: data.token,
                isGuest: data.user.isGuest,
            };

            setSession(newSession);
            return newSession;
        } catch (error) {
            console.error('Guest login error:', error);
            throw error;
        }
    };

    return {
        session,
        isLoading,
        loginAsGuest,
        logout: clearSession,
    };
}
