'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { useChat as useSocketChat, useSocket, usePlaybackSync, PendingChatMessage } from '../lib/socket/client';
import { SOCKET_EVENTS } from '../lib/socket/types';

export default function ChatRoom() {
  const t = useTranslations('chat');
  const locale = useLocale();
  const normalizedLocale: 'pt' | 'en' = locale === 'en' ? 'en' : 'pt';
  const { data: session } = useSession();
  // Prefer socket userId, fallback to session or anonymous
  const { messages, isLoadingAI, hasPendingMessage, addPendingMessage } = useSocketChat();
  const { socket, sendChatMessage, userId: socketUserId } = useSocket();
  const youLabel = normalizedLocale === 'en' ? 'you' : 'você';

  // Use the socket's userId for consistency with the backend
  const userId = socketUserId || (session?.user as any)?.id || 'anonymous-user';

  const [username, setUsername] = useState(session?.user?.name || `user_${userId.substring(0, 6)}`);
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

    socket.on(SOCKET_EVENTS.USER_UPDATE, handleUserUpdate);

    return () => {
      socket.off(SOCKET_EVENTS.USER_UPDATE, handleUserUpdate);
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
    if (input.trim() && sendChatMessage && !hasPendingMessage) {
      // Add pending message immediately for feedback
      addPendingMessage(input, { isPrivate: isPrivateMode, username });
      // Send to server for moderation
      sendChatMessage(input, { isPrivate: isPrivateMode, locale: normalizedLocale });
      setInput('');
    }
  };

  const handleQuickAction = (actionKey: string) => {
    if (sendChatMessage && !isLoadingAI && !hasPendingMessage) {
      const action = t(`quickActionsMessages.${actionKey}`);
      // Add pending message immediately for feedback
      addPendingMessage(action, { isPrivate: isPrivateMode, username });
      sendChatMessage(action, { isPrivate: isPrivateMode, locale: normalizedLocale });
    }
  };

  // Format timestamp
  const formatTime = (timestamp: number) => {
    const localeForDate = normalizedLocale === 'en' ? 'en-US' : 'pt-BR';
    return new Date(timestamp).toLocaleTimeString(localeForDate, {
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
    return messages
      .filter(msg => {
        if (!msg.isPrivate) return true; // Public messages always shown

        // Private messages: show if I sent it OR if it's sent to me
        return msg.userId === userId || msg.targetUserId === userId;
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [messages, userId]);

  // Group messages by time (within 2 minutes)
  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: PendingChatMessage[] }[] = [];
    let currentGroup: PendingChatMessage[] = [];
    let currentDate = '';

    filteredMessages.forEach((msg, index) => {
      const msgDate = new Date(msg.timestamp).toLocaleDateString(normalizedLocale === 'en' ? 'en-US' : 'pt-BR');

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
    <div className="relative flex flex-col h-full overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 shadow-2xl shadow-black/40">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(124,58,237,0.15),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(16,185,129,0.18),transparent_35%),radial-gradient(circle_at_50%_80%,rgba(236,72,153,0.12),transparent_40%)]" />
        <div className="absolute -left-16 top-10 h-40 w-40 rounded-full bg-purple-500/10 blur-3xl float-slow" />
        <div className="absolute -right-10 bottom-20 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl float-slower" />
      </div>

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/5 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-lofi-500 flex items-center justify-center shadow-lg shadow-purple-500/30">
              <span className="text-white text-lg animate-pulse">🎧</span>
            </div>
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-400 border-2 border-slate-950 rounded-full shadow-md"></span>
          </div>
          <div>
            <h2 className="font-semibold text-white drop-shadow-sm">{t('djName')}</h2>
            <p className="text-xs text-slate-200/70">{t('djStatus')}</p>
          </div>
        </div>
        {currentTrack && (
          <div className="hidden sm:flex items-center gap-2 text-xs text-white/90 bg-white/10 px-3 py-1 rounded-full backdrop-blur-md border border-white/10 shadow-inner">
            <span className="animate-pulse">🎵</span>
            <span className="truncate max-w-32">{currentTrack.title}</span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div
        ref={chatContainerRef}
        className="relative z-10 flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth min-h-0"
      >
        {filteredMessages.length === 0 && !isLoadingAI && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500/20 to-lofi-500/20 flex items-center justify-center mb-4">
              <span className="text-3xl">👋</span>
            </div>
            <h3 className="font-semibold text-gray-800 dark:text-white mb-2">
              {t('welcome.title')}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
              {t('welcome.description')}
            </p>
          </div>
        )}

        {groupedMessages.map((group) => (
          <div key={group.date}>
            {/* Date separator */}
            {group.date !== new Date().toLocaleDateString(normalizedLocale === 'en' ? 'en-US' : 'pt-BR') && (
              <div className="flex items-center justify-center my-4">
                <span className="text-xs text-slate-200/80 bg-white/10 px-3 py-1 rounded-full border border-white/10 backdrop-blur-sm">
                  {group.date}
                </span>
              </div>
            )}

            {/* Messages */}
            <div className="space-y-4">
              {group.messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  formatTime={formatTime}
                  isCurrentUser={msg.userId === userId}
                  djName={t('djName')}
                  isDirectToUser={!!(msg.isPrivate && msg.targetUserId === userId)}
                  youLabel={youLabel}
                  isPending={msg.isPending}
                  isFailed={msg.isFailed}
                />
              ))}
            </div>
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
      <div className="relative z-10 border-t border-white/5 bg-white/5 backdrop-blur-md">
        {/* Private Mode Toast (Temporary) */}
        {showPrivateToast && (
          <div className="absolute -top-12 left-0 right-0 flex justify-center px-4 animate-fade-in-up z-10">
            <div className="bg-gradient-to-r from-purple-600 to-lofi-600 text-white text-xs px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
              <span>🔒</span>
              <span>{t('privateMode.toast')}</span>
            </div>
          </div>
        )}

        {/* Persistent Private Mode Warning */}
        {isPrivateMode && (
          <div className="bg-amber-500/10 px-4 py-2 border-b border-amber-200/40 flex items-center justify-between gap-2 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-xs text-amber-100">
              <span className="text-lg">🤫</span>
              <span dangerouslySetInnerHTML={{ __html: t.raw('privateMode.warning') }} />
            </div>
            <button
              onClick={() => setIsPrivateMode(false)}
              className="text-xs font-medium text-amber-200 hover:underline"
            >
              {t('privateMode.exitButton')}
            </button>
          </div>
        )}

        {/* Quick action pills - always visible */}
        <div className="px-4 pt-3 pb-2">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => handleQuickAction('study')}
              disabled={isLoadingAI || hasPendingMessage}
              className="px-2.5 py-1 text-xs bg-white/10 hover:bg-white/20 disabled:opacity-50 text-slate-100 rounded-full border border-white/15 transition-colors whitespace-nowrap backdrop-blur-sm"
            >
              {t('quickActions.study')}
            </button>
            <button
              type="button"
              onClick={() => handleQuickAction('energy')}
              disabled={isLoadingAI || hasPendingMessage}
              className="px-2.5 py-1 text-xs bg-white/10 hover:bg-white/20 disabled:opacity-50 text-slate-100 rounded-full border border-white/15 transition-colors whitespace-nowrap backdrop-blur-sm"
            >
              {t('quickActions.energy')}
            </button>
            <button
              type="button"
              onClick={() => handleQuickAction('relax')}
              disabled={isLoadingAI || hasPendingMessage}
              className="px-2.5 py-1 text-xs bg-white/10 hover:bg-white/20 disabled:opacity-50 text-slate-100 rounded-full border border-white/15 transition-colors whitespace-nowrap backdrop-blur-sm"
            >
              {t('quickActions.relax')}
            </button>
            <button
              type="button"
              onClick={() => handleQuickAction('queue')}
              disabled={isLoadingAI || hasPendingMessage}
              className="px-2.5 py-1 text-xs bg-white/10 hover:bg-white/20 disabled:opacity-50 text-slate-100 rounded-full border border-white/15 transition-colors whitespace-nowrap backdrop-blur-sm"
            >
              {t('quickActions.queue')}
            </button>
            <button
              type="button"
              onClick={() => handleQuickAction('myRequests')}
              disabled={isLoadingAI || hasPendingMessage}
              className="px-2.5 py-1 text-xs bg-white/10 hover:bg-white/20 disabled:opacity-50 text-slate-100 rounded-full border border-white/15 transition-colors whitespace-nowrap backdrop-blur-sm"
            >
              {t('quickActions.myRequests')}
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
                disabled={isLoadingAI || hasPendingMessage}
                className="flex-1 px-4 py-2.5 border border-white/15 rounded-full bg-white/10 text-white text-sm focus:ring-2 focus:ring-lofi-400 focus:border-transparent outline-none transition-all placeholder-white/50 backdrop-blur-sm"
                placeholder={hasPendingMessage ? t('input.placeholderModerating') : (isLoadingAI ? t('input.placeholderLoading') : (isPrivateMode ? t('input.placeholderPrivate') : t('input.placeholder')))}
              />
              <button
                type="submit"
                disabled={isLoadingAI || hasPendingMessage || !input.trim()}
                className={`px-4 py-2.5 text-white rounded-full transition-all duration-200 flex items-center gap-2 ${isPrivateMode
                  ? 'bg-gradient-to-r from-slate-700 to-slate-900 hover:from-slate-800 hover:to-black shadow-lg shadow-black/30'
                  : 'bg-gradient-to-r from-purple-500 to-lofi-500 hover:from-purple-600 hover:to-lofi-600 shadow-lg shadow-purple-500/40'
                  } disabled:from-gray-300 disabled:to-gray-400 disabled:opacity-50`}
              >
                {hasPendingMessage ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                  </svg>
                )}
              </button>
            </div>

            {/* Private Mode Toggle */}
            <div className="flex items-center gap-2 px-2">
              <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer select-none group">
                <div className="relative">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={isPrivateMode}
                    onChange={(e) => setIsPrivateMode(e.target.checked)}
                  />
                  <div className={`w-8 h-4 rounded-full transition-colors ${isPrivateMode ? 'bg-slate-700' : 'bg-white/40'}`}></div>
                  <div className={`absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${isPrivateMode ? 'translate-x-4' : 'translate-x-0'}`}></div>
                </div>
                <span className={`transition-colors ${isPrivateMode ? 'text-white font-medium' : 'text-white/70'}`}>
                  {isPrivateMode ? `🔒 ${t('privateMode.toggle')}` : t('privateMode.togglePublic')}
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
  isCurrentUser,
  djName,
  isDirectToUser,
  youLabel,
  isPending,
  isFailed
}: {
  message: PendingChatMessage;
  formatTime: (timestamp: number) => string;
  isCurrentUser: boolean;
  djName: string;
  isDirectToUser: boolean;
  youLabel: string;
  isPending?: boolean;
  isFailed?: boolean;
}) {
  const isAI = message.type === 'ai' || message.type === 'system' || message.userId === 'dj';
  const isDJ = message.userId === 'dj' || message.username === 'Lofine';

  // Different styles for pending/failed states
  const bubbleHighlight = isPending
    ? 'border border-white/20 shadow-[0_10px_20px_rgba(0,0,0,0.2)] opacity-70'
    : isFailed
      ? 'border-2 border-red-500/50 shadow-[0_0_24px_rgba(239,68,68,0.3)]'
      : isDirectToUser
        ? 'border-2 border-amber-300/70 shadow-[0_0_24px_rgba(251,191,36,0.4)]'
        : isDJ
          ? 'border border-purple-200/40 shadow-[0_10px_30px_rgba(124,58,237,0.2)]'
          : 'border border-white/5 shadow-[0_10px_20px_rgba(0,0,0,0.2)]';

  return (
    <div className={`flex items-start gap-3 ${isCurrentUser ? 'flex-row-reverse' : ''} bubble-pop`}>
      <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${isAI ? 'bg-gradient-to-br from-purple-500 to-lofi-500 shadow-lg shadow-purple-500/30' : 'bg-white/10 text-white border border-white/10'}`}>
        <span className="text-white text-sm">{isAI ? '🎧' : message.username.charAt(0).toUpperCase()}</span>
      </div>
      <div
        className={`relative max-w-[75%] rounded-2xl px-4 py-3 backdrop-blur-sm ${isCurrentUser
          ? 'bg-gradient-to-r from-purple-500 to-lofi-500 text-white rounded-br-sm'
          : isAI
            ? 'bg-white/10 text-white rounded-tl-sm'
            : 'bg-white/5 text-white rounded-tl-sm'
          } ${bubbleHighlight}`}
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className={`text-sm font-semibold ${isCurrentUser ? 'text-white' : 'text-white/90'}`}>
            {isAI ? djName : message.username}
          </span>
          <div className="flex items-center gap-2">
            {isPending && (
              <div className="w-3 h-3 border-2 border-white/50 border-t-transparent rounded-full animate-spin"></div>
            )}
            {isFailed && (
              <span className="text-red-400 text-xs" title="Falha ao enviar">⚠️</span>
            )}
            <span className={`text-xs ${isCurrentUser ? 'text-white/70' : 'text-white/50'}`}>
              {isPending ? '' : formatTime(message.timestamp)}
            </span>
          </div>
        </div>
        <p className={`text-sm leading-relaxed whitespace-pre-wrap ${isPending ? 'text-white/60' : (isCurrentUser ? 'text-white/95' : 'text-white/85')}`}>
          {message.isPrivate && !isDirectToUser && <span className="text-xs opacity-70 mr-1">🔒</span>}
          {message.content}
        </p>
        {isFailed && (
          <p className="text-xs text-red-400 mt-1">Falha ao enviar. Tente novamente.</p>
        )}
        {isDirectToUser && (
          <span className="absolute -top-2.5 right-3 text-[10px] uppercase tracking-wide bg-amber-400 text-slate-900 font-bold px-2 py-0.5 rounded-full shadow-md">
            {djName.split(' ')[0]} → {youLabel}
          </span>
        )}
        {message.meta?.title && (
          <div className="mt-3 text-xs text-gray-200 border-t border-white/10 pt-2">
            <div className="font-medium">{message.meta.title}</div>
            {message.meta.artist && <div className="text-white/60 mt-0.5">{message.meta.artist}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// Subtle float/pulse keyframes for the lofi backdrop and message pop-in
const styles = `
@keyframes floatSlow {
  0% { transform: translate3d(0, 0, 0); }
  50% { transform: translate3d(0, -10px, 0); }
  100% { transform: translate3d(0, 0, 0); }
}
@keyframes floatSlower {
  0% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(-6px, 6px, 0) scale(1.04); }
  100% { transform: translate3d(0, 0, 0) scale(1); }
}
@keyframes popIn {
  0% { transform: translateY(8px) scale(0.97); opacity: 0; }
  100% { transform: translateY(0) scale(1); opacity: 1; }
}
.float-slow { animation: floatSlow 12s ease-in-out infinite; }
.float-slower { animation: floatSlower 14s ease-in-out infinite; }
.bubble-pop { animation: popIn 180ms ease-out; }
`;

// Inject styles once for this component
if (typeof document !== 'undefined' && !document.getElementById('chatroom-lofi-styles')) {
  const styleTag = document.createElement('style');
  styleTag.id = 'chatroom-lofi-styles';
  styleTag.innerHTML = styles;
  document.head.appendChild(styleTag);
}
