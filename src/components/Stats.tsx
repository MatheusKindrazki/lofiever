'use client';

import { useState, useEffect } from 'react';
import { getStreamData } from '../lib/api';

interface StreamStats {
  listenersCount: number;
  daysActive: number;
  songsPlayed: number;
}

export default function Stats() {
  const [stats, setStats] = useState<StreamStats>({
    listenersCount: 0,
    daysActive: 0,
    songsPlayed: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    
    async function fetchStats() {
      try {
        setLoading(true);
        const data = await getStreamData();
        
        if (isMounted) {
          setStats({
            listenersCount: data.listeners,
            daysActive: data.daysActive,
            songsPlayed: data.songsPlayed
          });
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError('Failed to load statistics');
          console.error('Error fetching stats:', err);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }
    
    fetchStats();
    
    // Refresh stats every minute
    const intervalId = setInterval(fetchStats, 60000);
    
    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, []);

  if (loading) {
    return (
      <div className="w-full">
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((index) => (
            <div key={index} className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 animate-pulse">
              <div className="h-6 w-6 mx-auto mb-2 bg-gray-300 dark:bg-gray-600 rounded-full" />
              <div className="h-5 w-16 mx-auto mb-2 bg-gray-300 dark:bg-gray-600 rounded" />
              <div className="h-4 w-12 mx-auto bg-gray-300 dark:bg-gray-600 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full">
        <div className="bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 text-center text-red-600 dark:text-red-400">
          <p>{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="mt-2 text-sm underline hover:no-underline"
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="grid grid-cols-3 gap-4">
        <StatCard 
          value={stats.listenersCount} 
          label="Listeners" 
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          } 
        />
        <StatCard 
          value={stats.daysActive} 
          label="Days Active" 
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          } 
        />
        <StatCard 
          value={stats.songsPlayed} 
          label="Songs Played" 
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          } 
        />
      </div>
    </div>
  );
}

function StatCard({ 
  value, 
  label, 
  icon 
}: { 
  value: number; 
  label: string; 
  icon: React.ReactNode; 
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 text-center">
      <div className="flex justify-center mb-2 text-lofi-500">
        {icon}
      </div>
      <div className="text-2xl font-bold text-gray-800 dark:text-white">
        {value.toLocaleString()}
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        {label}
      </div>
    </div>
  );
} 