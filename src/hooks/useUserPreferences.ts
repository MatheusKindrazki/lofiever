import { useState, useEffect } from 'react';

/**
 * User preferences stored in localStorage
 */
interface UserPreferences {
    volume: number;
    // Futuras preferências podem ser adicionadas aqui
    // theme?: 'light' | 'dark';
    // autoplay?: boolean;
}

const STORAGE_KEY = 'lofiever:preferences';

const DEFAULT_PREFERENCES: UserPreferences = {
    volume: 70, // Volume padrão 70%
};

/**
 * Hook to manage user preferences with localStorage persistence
 */
export function useUserPreferences() {
    const [preferences, setPreferencesState] = useState<UserPreferences>(DEFAULT_PREFERENCES);
    const [isLoaded, setIsLoaded] = useState(false);

    // Load preferences from localStorage on mount
    useEffect(() => {
        if (typeof window === 'undefined') return;

        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored) as UserPreferences;
                setPreferencesState({ ...DEFAULT_PREFERENCES, ...parsed });
            }
        } catch (error) {
            console.error('Failed to load user preferences:', error);
        } finally {
            setIsLoaded(true);
        }
    }, []);

    // Save preferences to localStorage whenever they change
    const setPreferences = (newPreferences: Partial<UserPreferences>) => {
        setPreferencesState((prev) => {
            const updated = { ...prev, ...newPreferences };

            // Save to localStorage
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            } catch (error) {
                console.error('Failed to save user preferences:', error);
            }

            return updated;
        });
    };

    // Helper to update just volume
    const setVolume = (volume: number) => {
        setPreferences({ volume });
    };

    // Reset to defaults
    const resetPreferences = () => {
        setPreferencesState(DEFAULT_PREFERENCES);
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (error) {
            console.error('Failed to reset user preferences:', error);
        }
    };

    return {
        preferences,
        isLoaded,
        setPreferences,
        setVolume,
        resetPreferences,
    };
}
