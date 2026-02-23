import { getAIFallbackContent, resolveAIMessageContent, shouldSkipAIReply } from '../chat-policy';

describe('socket server chat policy helpers', () => {
  it('should skip AI reply for public chat when listeners are below minimum', () => {
    expect(shouldSkipAIReply(0, false, 1)).toBe(true);
  });

  it('should not skip AI reply for public chat with at least one listener', () => {
    expect(shouldSkipAIReply(1, false, 1)).toBe(false);
  });

  it('should never skip AI reply for private chat', () => {
    expect(shouldSkipAIReply(0, true, 1)).toBe(false);
  });

  it('should return localized fallback content', () => {
    expect(getAIFallbackContent('pt')).toContain('mini bug');
    expect(getAIFallbackContent('en')).toContain('hiccup');
  });

  it('should fallback when AI content is empty', () => {
    expect(resolveAIMessageContent('', 'pt')).toContain('mini bug');
    expect(resolveAIMessageContent('   ', 'en')).toContain('hiccup');
  });

  it('should keep non-empty AI content unchanged', () => {
    expect(resolveAIMessageContent('ola, tudo certo?', 'pt')).toBe('ola, tudo certo?');
  });
});
