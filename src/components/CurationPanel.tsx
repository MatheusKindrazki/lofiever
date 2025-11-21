'use client';

import { useEffect, useMemo, useState } from 'react';
import { defaultCurationPrompt, getAIRecommendations } from '@/lib/api';
import type { AIRecommendation } from '@/lib/api';

export default function CurationPanel() {
  const [prompt, setPrompt] = useState('');
  const [recommendations, setRecommendations] = useState<AIRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRecommendations(defaultCurationPrompt, true).catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recommendationCards = useMemo(() => {
    if (recommendations.length === 0) return null;

    return recommendations.map((rec, index) => (
      <div
        key={`${rec.title}-${rec.artist}-${index}`}
        className="flex flex-col gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 shadow-sm"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Suggested #{index + 1}</p>
            <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {rec.title} <span className="text-sm font-normal text-gray-500 dark:text-gray-400">por {rec.artist}</span>
            </p>
          </div>
          <div className="text-right text-sm text-gray-500 dark:text-gray-400">
            <p>BPM: {rec.bpm}</p>
            <p>Duração: {formatDuration(rec.duration)}</p>
          </div>
        </div>
        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-300">
          <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800 dark:bg-purple-900 dark:text-purple-100">
            {rec.mood}
          </span>
        </div>
        {rec.description && (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {rec.description}
          </p>
        )}
      </div>
    ));
  }, [recommendations]);

  async function fetchRecommendations(promptText: string, isAuto = false) {
    try {
      setIsLoading(true);
      setError(null);
      const payload = promptText.trim() || defaultCurationPrompt;
      const result = await getAIRecommendations(payload);
      setRecommendations(result.recommendations);
      if (!isAuto) {
        setPrompt('');
      }
    } catch (err) {
      console.error('Failed to fetch AI recommendations:', err);
      setError('Não consegui gerar recomendações agora. Tente de novo em instantes.');
    } finally {
      setIsLoading(false);
    }
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading) return;
    fetchRecommendations(prompt);
  };

  return (
    <section className="rounded-xl bg-white dark:bg-gray-800 shadow-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Curadoria por I.A.</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Peça um clima e deixe a Lofine montar a sequência.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mb-4 flex flex-col gap-2">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Ex.: Preciso de algo calmo para estudar à noite com um toque de jazz."
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 p-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-lofi-500"
          rows={3}
          disabled={isLoading}
        />
        <div className="flex items-center justify-between">
          <button
            type="submit"
            disabled={isLoading}
            className="px-4 py-2 rounded-md bg-lofi-500 text-white text-sm font-medium hover:bg-lofi-600 disabled:bg-lofi-300 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Curando vibe...' : 'Gerar playlist'}
          </button>
          <button
            type="button"
            onClick={() => fetchRecommendations(defaultCurationPrompt)}
            disabled={isLoading}
            className="text-sm text-gray-500 dark:text-gray-300 hover:text-gray-700 disabled:text-gray-400"
          >
            Usar prompt padrão
          </button>
        </div>
      </form>

      {error && (
        <p className="text-sm text-red-500 mb-3">{error}</p>
      )}

      <div className="space-y-3 max-h-72 overflow-y-auto pr-2">
        {isLoading && recommendations.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">Buscando recomendações...</p>
        )}
        {!isLoading && recommendations.length === 0 && !error && (
          <p className="text-sm text-gray-500 dark:text-gray-400">Sem sugestões ainda. Envie um prompt!</p>
        )}
        {recommendationCards}
      </div>
    </section>
  );
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toString().padStart(2, '0')}s`;
}
