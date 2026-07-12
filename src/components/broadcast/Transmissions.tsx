'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSession } from 'next-auth/react';
import type { PendingChatMessage } from '@/lib/socket/client';
import { useChat as useSocketChat, useSocket } from '@/lib/socket/client';
import { LofineMark } from './icons';

const DJ_NAME = 'Lofine';

/* ============================================================
   TRANSMISSIONS — chat as "letters to the station", with Lofine
   (the AI host) as a columnist. Wired to the real socket layer.
   ============================================================ */
export function Transmissions({ accent, showMascot = true }: { accent: string; showMascot?: boolean }) {
  const t = useTranslations('chat');
  const locale = useLocale();
  const normalizedLocale: 'pt' | 'en' = locale === 'en' ? 'en' : 'pt';
  const { data: session } = useSession();

  const {
    messages,
    isLoadingAI,
    chatError,
    hasPendingMessage,
    addPendingMessage,
    retryMessage,
    removeFailedMessage,
  } = useSocketChat();
  const { sendChatMessage, userId: socketUserId, username: socketUsername, isConnected } = useSocket();

  const userId = socketUserId || (session?.user as { id?: string } | undefined)?.id || 'anonymous-user';
  const username = socketUsername || session?.user?.name || `user_${userId.substring(0, 6)}`;

  const [val, setVal] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [messages, isLoadingAI]);

  const visible = useMemo(
    () =>
      messages
        .filter((m) => {
          if (!m.isPrivate) return true;
          return m.userId === userId || m.targetUserId === userId;
        })
        .sort((a, b) => a.timestamp - b.timestamp),
    [messages, userId],
  );

  const canSend = isConnected && !hasPendingMessage;

  const send = (text: string) => {
    const v = text.trim();
    if (!v || !canSend || !sendChatMessage) return;
    const { clientMessageId } = addPendingMessage(v, { username, locale: normalizedLocale });
    sendChatMessage(v, { locale: normalizedLocale, clientMessageId });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    send(val);
    setVal('');
  };

  const stamp = (ts: number) =>
    new Date(ts).toLocaleTimeString(normalizedLocale === 'en' ? 'en-US' : 'pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });

  const placeholder = !isConnected
    ? normalizedLocale === 'en'
      ? 'Reconnecting…'
      : 'Reconectando…'
    : hasPendingMessage
      ? t('input.placeholderModerating')
      : isLoadingAI
        ? t('input.placeholderLoading')
        : t('input.placeholder');

  return (
    <section className="panel tx-body">
      <div className="panel-head">
        <span className="ttl">Transmissions</span>
        <span className="meta">letters to the station</span>
      </div>

      <div className="tx-feed" ref={feedRef}>
        {visible.length === 0 && !isLoadingAI && (
          <div className="tx-msg system">
            <div className="tx-text">— {t('welcome.description')} —</div>
          </div>
        )}

        {visible.map((m) => (
          <Message
            key={m.id}
            message={m}
            stamp={stamp}
            isMine={m.userId === userId}
            showMascot={showMascot}
            accent={accent}
            djName={t('djName')}
            onRetry={m.tempId ? () => retryMessage(m.tempId!) : undefined}
            onRemove={m.tempId ? () => removeFailedMessage(m.tempId!) : undefined}
            retryLabel={normalizedLocale === 'en' ? 'Retry' : 'Tentar de novo'}
            removeLabel={normalizedLocale === 'en' ? 'Remove' : 'Remover'}
          />
        ))}

        {isLoadingAI && (
          <div className="tx-msg tx-dj">
            <div className="tx-byline">
              <span className="who">
                {showMascot && <LofineMark size={18} color={accent} />}
                {DJ_NAME}
                <span className="badge">AI Host</span>
              </span>
            </div>
            <div className="tx-typing">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
      </div>

      {chatError && (
        <div className="tx-status warn">
          {normalizedLocale === 'en'
            ? `DJ temporarily unavailable: ${chatError}`
            : `DJ indisponível no momento: ${chatError}`}
        </div>
      )}
      {!isConnected && (
        <div className="tx-status warn">
          {normalizedLocale === 'en' ? 'Reconnecting to the station…' : 'Reconectando à estação…'}
        </div>
      )}

      <div className="tx-quick">
        {(['study', 'energy', 'relax', 'queue'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className="tx-pill"
            disabled={isLoadingAI || hasPendingMessage || !isConnected}
            onClick={() => send(t(`quickActionsMessages.${key}`))}
          >
            {t(`quickActions.${key}`)}
          </button>
        ))}
      </div>

      <div className="tx-hint">
        Type <b>/request</b> a vibe and Lofine threads it into the program.
      </div>

      <form className="tx-compose" onSubmit={submit}>
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={placeholder}
          maxLength={180}
          disabled={!canSend}
          aria-label={placeholder}
        />
        <button className="tx-send" type="submit" disabled={!val.trim() || !canSend}>
          SEND
        </button>
      </form>
    </section>
  );
}

function Message({
  message,
  stamp,
  isMine,
  showMascot,
  accent,
  djName,
  onRetry,
  onRemove,
  retryLabel,
  removeLabel,
}: {
  message: PendingChatMessage;
  stamp: (ts: number) => string;
  isMine: boolean;
  showMascot: boolean;
  accent: string;
  djName: string;
  onRetry?: () => void;
  onRemove?: () => void;
  retryLabel: string;
  removeLabel: string;
}) {
  const isDJ = message.userId === 'dj' || message.userId === 'ai' || message.type === 'ai' || message.username === DJ_NAME;
  const isSystem = message.type === 'system' && !isDJ;

  if (isSystem) {
    return (
      <div className="tx-msg system">
        <div className="tx-text">— {message.content} —</div>
      </div>
    );
  }

  const cls = ['tx-msg'];
  if (isDJ) cls.push('tx-dj');
  else cls.push('reader');
  if (message.isPending) cls.push('pending');
  if (message.isFailed) cls.push('failed');

  return (
    <div className={cls.join(' ')}>
      <div className="tx-byline">
        <span className="who">
          {isDJ ? (
            <>
              {showMascot && <LofineMark size={18} color={accent} />}
              {djName}
              <span className="badge">AI Host</span>
            </>
          ) : (
            <>
              {isMine ? 'you' : message.username}
              {message.isPrivate && ' 🔒'}
            </>
          )}
        </span>
        <span className="stamp">
          {message.isPending ? '···' : message.isFailed ? '!' : stamp(message.timestamp)}
        </span>
      </div>
      <div className="tx-text">{message.content}</div>
      {message.meta?.title && (
        <div className="tx-text" style={{ opacity: 0.7, fontSize: 11 }}>
          ♪ {message.meta.title}
          {message.meta.artist ? ` — ${message.meta.artist}` : ''}
        </div>
      )}
      {message.isFailed && (
        <div className="tx-retry">
          {onRetry && (
            <button onClick={onRetry} type="button">
              {retryLabel}
            </button>
          )}
          {onRemove && (
            <button onClick={onRemove} type="button">
              {removeLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
