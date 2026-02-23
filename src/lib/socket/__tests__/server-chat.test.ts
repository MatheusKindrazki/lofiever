import { getAIFallbackContent, shouldSkipAIReply } from '../chat-policy';

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
});
