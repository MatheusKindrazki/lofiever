export interface ReconnectionConfig {
  initialDelay: number;
  maxDelay: number;
  factor: number;
  maxAttempts: number;
  jitter: boolean;
}

export const DEFAULT_RECONNECTION_CONFIG: ReconnectionConfig = {
  initialDelay: 1000,
  maxDelay: 30000,
  factor: 2,
  maxAttempts: 10,
  jitter: true,
};

export function calculateBackoff(
  attempt: number,
  config: ReconnectionConfig = DEFAULT_RECONNECTION_CONFIG,
): number {
  const baseDelay = Math.min(
    config.initialDelay * Math.pow(config.factor, attempt),
    config.maxDelay,
  );

  if (config.jitter) {
    return Math.random() * baseDelay;
  }

  return baseDelay;
}

export function shouldSkipAIReply(
  listenersCount: number,
  isPrivate: boolean,
  minListeners: number,
): boolean {
  return !isPrivate && listenersCount < minListeners;
}

export function getAIFallbackContent(locale: 'pt' | 'en'): string {
  return locale === 'en'
    ? 'Had a little hiccup here. Try again in a sec and we keep the vibe going.'
    : 'Deu um mini bug aqui. Tenta de novo em instantes que seguimos na vibe.';
}

export function resolveAIMessageContent(content: string, locale: 'pt' | 'en'): string {
  const trimmed = content.trim();
  if (trimmed.length > 0) {
    return content;
  }

  return getAIFallbackContent(locale);
}
