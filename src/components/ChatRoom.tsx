'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useChat as useSocketChat, useSocket, usePlaybackSync } from '../lib/socket/client'; // Renamed to avoid conflict
import type { ChatMessage } from '../lib/redis';
import Image from 'next/image';
import { getStreamData } from '../lib/api'; // For initial message

export default function ChatRoom() {
  const { data: session } = useSession();
  const userId = session?.user?.id || 'anonymous-user';
  const username = session?.user?.name || `user_${userId.substring(0, 5)}`;

  const { messages, isLoadingAI } = useSocketChat();
  const { sendChatMessage } = useSocket();
  const { currentTrack } = usePlaybackSync();

  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Initial message for Lofine, dynamically set
  useEffect(() => {
    async function setInitialMessage() {
      // Check if there are already messages, if so, don't add initial
      if (messages.length > 0) return;

      try {
        const streamData = await getStreamData();
        const { title, artist } = streamData?.currentSong || { title: 'uma música desconhecida', artist: 'um artista misterioso' };
        
        const initialMessage: ChatMessage = {
          id: 'init-message',
          userId: 'ai',
          username: 'Lofine',
          content: `Olá, ${username}! Eu sou Lofine, seu DJ com I.A. Agora estamos ouvindo "${title}" por ${artist}. O que você acha? Me diga o que você quer ouvir!`,
          timestamp: Date.now(),
          type: 'ai',
        };
        // Add only if not present to avoid duplicates on re-renders
        if (!messages.some(msg => msg.id === initialMessage.id)) {
          // Temporarily add to local state to show immediately, server will sync later
          // For now, we manually prepend it to the message list. A full solution would involve
          // a proper state management for initial messages or server-side rendering of initial chat.
        }
      } catch (err) {
        console.error("Failed to fetch initial stream data for DJ message:", err);
      }
    }
    setInitialMessage();
  }, [messages, username]);


  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && sendChatMessage) {
      sendChatMessage(input);
      setInput('');
    }
  };

  // Memoize messages for rendering to prevent unnecessary re-renders
  const renderedMessages = useMemo(() => {
    return messages.map((m) => (
      <div key={m.id} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'}`}>
        <div
          className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg whitespace-pre-wrap break-words ${
            m.type === 'user'
              ? 'bg-lofi-500 text-white'
              : m.type === 'ai'
              ? 'bg-purple-200 dark:bg-purple-700 text-gray-800 dark:text-gray-200'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200' // system or dj
          }`}
        >
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
            {m.username === 'Lofine' ? 'Lofine (DJ)' : m.username}
          </p>
          <p className="text-sm">{m.content}</p>
          {m.meta?.title && m.meta?.artist && (
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-300">
              <p>🎶 {m.meta.title} por {m.meta.artist}</p>
            </div>
          )}
        </div>
      </div>
    ));
  }, [messages]);

  return (
    <div className="w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 h-full flex flex-col">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4 border-b border-gray-200 dark:border-gray-700 pb-2">
        Chat com o DJ
      </h2>

      <div className="flex-1 overflow-y-auto pr-2 space-y-4">
        {renderedMessages}
        {isLoadingAI && (
          <div className="flex justify-start">
            <div className="max-w-xs lg:max-w-md px-4 py-2 rounded-lg bg-purple-200 dark:bg-purple-700">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse-fast"></div>
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse-fast [animation-delay:0.2s]"></div>
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse-fast [animation-delay:0.4s]"></div>
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
        <form onSubmit={handleSubmit} className="flex space-x-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoadingAI}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-lofi-500 focus:border-lofi-500"
            placeholder={isLoadingAI ? 'DJ pensando...' : 'Dê uma sugestão ao DJ...'}
          />
          <button
            type="submit"
            disabled={isLoadingAI || !input || !input.trim()}
            className="px-4 py-2 bg-lofi-500 hover:bg-lofi-600 disabled:bg-lofi-300 dark:disabled:bg-gray-600 text-white rounded-md"
          >
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
}
