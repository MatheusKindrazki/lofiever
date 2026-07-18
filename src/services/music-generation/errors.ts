export class MusicGenerationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'MusicGenerationError';
  }
}
