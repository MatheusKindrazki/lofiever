import { calculateBackoff } from '../chat-policy';

describe('socket client chat/backoff helpers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should apply jittered exponential backoff', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    expect(calculateBackoff(0)).toBe(500);
    expect(calculateBackoff(1)).toBe(1000);
    expect(calculateBackoff(5)).toBe(15000);
  });

  it('should cap delay at max backoff', () => {
    jest.spyOn(Math, 'random').mockReturnValue(1);
    expect(calculateBackoff(20)).toBe(30000);
  });
});
