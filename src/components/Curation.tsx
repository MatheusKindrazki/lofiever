'use client';

import { useState } from 'react';
import { getAIRecommendations, defaultCurationPrompt } from '../lib/api';

interface Recommendation {
  title: string;
  artist: string;
  mood: string;
  bpm: number;
  duration: number;
}

export default function Curation() {
  const [prompt, setPrompt] = useState(defaultCurationPrompt);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await getAIRecommendations(prompt);
      setRecommendations(response.recommendations);
    } catch (err) {
      setError('Failed to get AI recommendations. Please try again.');
      console.error('Error getting AI recommendations:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white">
          AI Curated Music
        </h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-lofi-500 hover:text-lofi-600 dark:text-lofi-400 dark:hover:text-lofi-300 text-sm"
          type="button"
        >
          {showForm ? 'Hide Prompt' : 'Customize Prompt'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 space-y-4">
          <div>
            <label htmlFor="prompt" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Curation Prompt
            </label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={handlePromptChange}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
              rows={4}
              placeholder="Describe the type of lofi music you want..."
            />
          </div>
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            className="w-full px-4 py-2 bg-lofi-500 hover:bg-lofi-600 disabled:bg-lofi-300 dark:disabled:bg-lofi-800 text-white rounded-md"
          >
            {loading ? 'Getting Recommendations...' : 'Get Recommendations'}
          </button>
        </form>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col space-y-3">
          {[1, 2, 3].map((index) => (
            <div key={index} className="animate-pulse flex space-x-3 py-2">
              <div className="h-10 w-10 bg-gray-300 dark:bg-gray-600 rounded" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 bg-gray-300 dark:bg-gray-600 rounded" />
                <div className="h-3 w-1/2 bg-gray-300 dark:bg-gray-600 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : recommendations.length > 0 ? (
        <ul className="space-y-2">
          {recommendations.map((rec, index) => (
            <li key={index} className="border-b border-gray-100 dark:border-gray-700 last:border-b-0 py-2">
              <div className="flex justify-between">
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-white">{rec.title}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{rec.artist}</p>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 flex flex-col items-end">
                  <span>{rec.mood}</span>
                  <span>{rec.bpm} BPM</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-center text-gray-500 dark:text-gray-400 py-8">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-2 text-lofi-300 dark:text-lofi-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
          <p className="mb-2">No recommendations yet</p>
          {!showForm && (
            <button
              onClick={() => {
                setShowForm(true);
                setTimeout(() => {
                  document.getElementById('prompt')?.focus();
                }, 100);
              }}
              className="text-lofi-500 hover:text-lofi-600 text-sm underline hover:no-underline"
              type="button"
            >
              Get AI recommendations
            </button>
          )}
        </div>
      )}
    </div>
  );
} 