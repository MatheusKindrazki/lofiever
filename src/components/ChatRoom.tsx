'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useChat as useSocketChat, useSocket, usePlaybackSync } from '../lib/socket/client';
import type { ChatMessage } from '../lib/redis';

export default function ChatRoom() {
  const { data: session } = useSession();
  // Prefer socket userId, fallback to session or anonymous
  const { messages, isLoadingAI } = useSocketChat();
  const { socket, sendChatMessage, userId: socketUserId } = useSocket();

  // Use the socket's userId for consistency with the backend
  const userId = socketUserId || (session?.user as any)?.id || 'anonymous-user';

  const [username, setUsername] = useState(session?.user?.name || `user_${userId.substring(0, 5)}`);
  const { currentTrack } = usePlaybackSync();

  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const [isPrivateMode, setIsPrivateMode] = useState(false);
  const [showPrivateToast, setShowPrivateToast] = useState(false);

  // Auto-switch to private mode when receiving a private message
  useEffect(() => {
    if (messages.length === 0) return;

    const lastMsg = messages[messages.length - 1];

    // Check if it's a NEW private message directed to me (not sent by me)
    // We check if it's the last message and if we are not already in private mode
    if (lastMsg.isPrivate && lastMsg.targetUserId === userId && !isPrivateMode) {
      setIsPrivateMode(true);
      setShowPrivateToast(true);

      // Hide toast after 3 seconds
      setTimeout(() => setShowPrivateToast(false), 3000);
    }
  }, [messages, userId, isPrivateMode]);

  // Listen for username updates
  useEffect(() => {
    if (!socket) return;

    const handleUserUpdate = (data: { username: string }) => {
      console.log('Username updated to:', data.username);
      setUsername(data.username);
      // Persist to localStorage so it survives refresh
      localStorage.setItem('username', data.username);
    };

    socket.on('user:update', handleUserUpdate);

    return () => {
      socket.off('user:update', handleUserUpdate);
    };
  }, [socket]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, isLoadingAI]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && sendChatMessage) {
      sendChatMessage(input, { isPrivate: isPrivateMode });
      setInput('');
    }
  };

  const handleQuickAction = (action: string) => {
    if (sendChatMessage && !isLoadingAI) {
      sendChatMessage(action, { isPrivate: isPrivateMode });
    }
  };

  // Format timestamp
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Filter messages based on private mode or visibility
  // If private mode is ON, show everything (including private messages)
  // If private mode is OFF, show only public messages
  // Actually, we should always show private messages if they belong to the user, regardless of toggle state?
  // Let's filter:
  // - Show public messages
  // - Show private messages ONLY if they are sent by me or sent to me
  const filteredMessages = useMemo(() => {
    return messages.filter(msg => {
      if (!msg.isPrivate) return true; // Public messages always shown

      // Private messages: show if I sent it OR if it's sent to me
      return msg.userId === userId || msg.targetUserId === userId;
    });
  }, [messages, userId]);

  // Group messages by time (within 2 minutes)
  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: ChatMessage[] }[] = [];
    let currentGroup: ChatMessage[] = [];
    let currentDate = '';

    filteredMessages.forEach((msg, index) => {
      const msgDate = new Date(msg.timestamp).toLocaleDateString('pt-BR');

      if (msgDate !== currentDate) {
        if (currentGroup.length > 0) {
          groups.push({ date: currentDate, messages: currentGroup });
        }
        currentDate = msgDate;
        currentGroup = [msg];
      } else {
        currentGroup.push(msg);
      }

      if (index === filteredMessages.length - 1 && currentGroup.length > 0) {
        groups.push({ date: currentDate, messages: currentGroup });
      }
    });

    return groups;
  }, [filteredMessages]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-purple-500/10 to-lofi-500/10">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-lofi-500 flex items-center justify-center">
              <span className="text-white text-lg">🎧</span>
            </div>
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full"></span>
          </div>
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-white">Lofine DJ</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Online • Pronto pra ajudar</p>
          </div>
        </div>
        {currentTrack && (
          <div className="hidden sm:flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-full">
            <span className="animate-pulse">🎵</span>
            <span className="truncate max-w-32">{currentTrack.title}</span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth min-h-0"
      >
        {filteredMessages.length === 0 && !isLoadingAI && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500/20 to-lofi-500/20 flex items-center justify-center mb-4">
              <span className="text-3xl">👋</span>
            </div>
            <h3 className="font-semibold text-gray-800 dark:text-white mb-2">
              Olá! Eu sou a Lofine
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
              Sua DJ virtual. Me peça músicas, sugira um mood, ou só bata um papo sobre a playlist!
            </p>
          </div>
        )}

        {groupedMessages.map((group) => (
          <div key={group.date}>
            {/* Date separator */}
            {group.date !== new Date().toLocaleDateString('pt-BR') && (
              <div className="flex items-center justify-center my-4">
                <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full">
                  {group.date}
                </span>
              </div>
            )}

            {/* Messages */}
            {group.messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                formatTime={formatTime}
                isCurrentUser={msg.userId === userId}
              />
            ))}
          </div>
        ))}

        {/* Loading indicator */}
        {isLoadingAI && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-lofi-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-sm">🎧</span>
            </div>
            <div className="bg-gray-100 dark:bg-gray-700 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input area with quick actions */}
      <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 relative">
        {/* Private Mode Toast (Temporary) */}
        {showPrivateToast && (
          <div className="absolute -top-12 left-0 right-0 flex justify-center px-4 animate-fade-in-up z-10">
            <div className="bg-purple-600 text-white text-xs px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
              <span>🔒</span>
              <span>O chat mudou para privado automaticamente.</span>
            </div>
          </div>
        )}

        {/* Persistent Private Mode Warning */}
        {isPrivateMode && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 px-4 py-2 border-b border-yellow-100 dark:border-yellow-900/30 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-yellow-800 dark:text-yellow-200">
              <span className="text-lg">🤫</span>
              <span>Você está falando <b>apenas com o DJ</b>. Para falar com todos, desmarque a opção abaixo.</span>
            </div>
            <button
              onClick={() => setIsPrivateMode(false)}
              className="text-xs font-medium text-yellow-700 dark:text-yellow-300 hover:underline"
            >
              Sair do privado
            </button>
          </div>
        )}

        {/* Quick action pills - always visible */}
        <div className="px-4 pt-3 pb-2">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => handleQuickAction('Quero algo relaxante pra estudar')}
              disabled={isLoadingAI}
              className="px-2.5 py-1 text-xs bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-600 dark:text-gray-300 rounded-full border border-gray-200 dark:border-gray-600 transition-colors whitespace-nowrap"
            >
              🎓 Estudar
            </button>
            <button
              type="button"
              onClick={() => handleQuickAction('Coloca algo mais animado pra dar energia')}
              disabled={isLoadingAI}
              className="px-2.5 py-1 text-xs bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-600 dark:text-gray-300 rounded-full border border-gray-200 dark:border-gray-600 transition-colors whitespace-nowrap"
            >
              ⚡ Energia
            </button>
            <button
              type="button"
              onClick={() => handleQuickAction('Quero músicas calmas e relaxantes')}
              disabled={isLoadingAI}
              className="px-2.5 py-1 text-xs bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-600 dark:text-gray-300 rounded-full border border-gray-200 dark:border-gray-600 transition-colors whitespace-nowrap"
            >
              🌙 Relaxar
            </button>
            <button
              type="button"
              onClick={() => handleQuickAction('Me mostra as próximas músicas da fila')}
              disabled={isLoadingAI}
              className="px-2.5 py-1 text-xs bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-600 dark:text-gray-300 rounded-full border border-gray-200 dark:border-gray-600 transition-colors whitespace-nowrap"
            >
              📋 Fila
            </button>
            <button
              type="button"
              onClick={() => handleQuickAction('Quantos pedidos eu ainda tenho?')}
              disabled={isLoadingAI}
              className="px-2.5 py-1 text-xs bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-600 dark:text-gray-300 rounded-full border border-gray-200 dark:border-gray-600 transition-colors whitespace-nowrap"
            >
              📊 Meus pedidos
            </button>
          </div>
        </div>

        {/* Input */}
        <div className="px-4 pb-4">
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isLoadingAI}
                className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-full bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-lofi-500 focus:border-transparent outline-none transition-all placeholder-gray-400"
                placeholder={isLoadingAI ? 'Lofine está pensando...' : (isPrivateMode ? 'Conversando em privado com Lofine...' : 'Peça uma música ou converse...')}
              />
              <button
                type="submit"
                disabled={isLoadingAI || !input.trim()}
                className={`px-4 py-2.5 text-white rounded-full transition-all duration-200 flex items-center gap-2 ${isPrivateMode
                  ? 'bg-gradient-to-r from-gray-700 to-gray-900 hover:from-gray-800 hover:to-black'
                  : 'bg-gradient-to-r from-purple-500 to-lofi-500 hover:from-purple-600 hover:to-lofi-600'
                  } disabled:from-gray-300 disabled:to-gray-400`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                </svg>
              </button>
            </div>

            {/* Private Mode Toggle */}
            <div className="flex items-center gap-2 px-2">
              <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 cursor-pointer select-none group">
                <div className="relative">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={isPrivateMode}
                    onChange={(e) => setIsPrivateMode(e.target.checked)}
                  />
                  <div className={`w-8 h-4 rounded-full transition-colors ${isPrivateMode ? 'bg-gray-700 dark:bg-gray-600' : 'bg-gray-300 dark:bg-gray-600'}`}></div>
                  <div className={`absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${isPrivateMode ? 'translate-x-4' : 'translate-x-0'}`}></div>
                </div>
                <span className={`transition-colors ${isPrivateMode ? 'text-gray-800 dark:text-gray-200 font-medium' : ''}`}>
                  {isPrivateMode ? '🔒 Conversa privada com DJ' : 'Conversa pública'}
                </span>
              </label>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  formatTime,
  isCurrentUser
}: {
  message: ChatMessage;
  formatTime: (timestamp: number) => string;
  isCurrentUser: boolean;
}) {
  const isAI = message.type === 'ai' || message.type === 'system' || message.userId === 'dj';
  const isUser = message.type === 'user';
  const isPrivate = message.isPrivate;

  if (isUser && isCurrentUser) {
    // Current user's message - right aligned
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] sm:max-w-[70%]">
          <div className={`rounded-2xl rounded-br-sm px-4 py-2.5 text-white ${isPrivate
            ? 'bg-gradient-to-r from-gray-600 to-gray-800'
            : 'bg-gradient-to-r from-lofi-500 to-purple-500'
            }`}>
            <p className="text-sm whitespace-pre-wrap break-words">
              {isPrivate && <span className="text-xs opacity-70 mr-1">🔒</span>}
              {message.content}
            </p>
          </div>
          <p className="text-xs text-gray-400 text-right mt-1">
            {formatTime(message.timestamp)}
          </p>
        </div>
      </div>
    );
  }

  if (isAI) {
    // AI/DJ message - left aligned with avatar
    return (
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-lofi-500 flex items-center justify-center flex-shrink-0">
          <span className="text-white text-sm">🎧</span>
        </div>
        <div className="max-w-[80%] sm:max-w-[70%]">
          <div className={`rounded-2xl rounded-tl-sm px-4 py-2.5 ${isPrivate
            ? 'bg-gray-200 dark:bg-gray-600 border border-gray-300 dark:border-gray-500'
            : 'bg-gray-100 dark:bg-gray-700'
            }`}>
            <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
              {isPrivate && <span className="text-xs opacity-70 mr-1">🔒</span>}
              {message.content}
            </p>
            {message.meta?.title && (
              <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600">
                <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <span>🎵</span>
                  {message.meta.title} - {message.meta.artist}
                </p>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Lofine • {formatTime(message.timestamp)}
          </p>
        </div>
      </div>
    );
  }

  // Other user's message
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
        <span className="text-gray-600 dark:text-gray-300 text-sm">👤</span>
      </div>
      <div className="max-w-[80%] sm:max-w-[70%]">
        <div className="bg-gray-100 dark:bg-gray-700 rounded-2xl rounded-tl-sm px-4 py-2.5">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{message.username}</p>
          <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
            {message.content}
          </p>
        </div>
        <p className="text-xs text-gray-400 mt-1">
          {formatTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}
