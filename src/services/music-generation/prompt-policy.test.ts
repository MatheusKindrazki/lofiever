import { normalizeMusicPrompt } from './prompt-policy';

describe('normalizeMusicPrompt', () => {
  it('produces a bounded instrumental lo-fi prompt', () => {
    const result = normalizeMusicPrompt({
      prompt: 'Rhodes quente, chuva leve na janela e bateria macia para estudar',
      title: 'Chuva na Biblioteca',
      mood: 'focused',
      bpm: 70,
      durationSeconds: 180,
    });

    expect(result).toMatchObject({
      title: 'Chuva na Biblioteca',
      mood: 'focused',
      bpm: 70,
      durationSeconds: 180,
    });
    expect(result.normalizedPrompt).toContain('Instrumental.');
    expect(result.normalizedPrompt).not.toContain('No vocals');
    expect(result.normalizedPrompt).toContain('70 BPM');
    expect(result.promptHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('always assigns a non-empty title when none is requested', () => {
    const result = normalizeMusicPrompt({
      prompt: 'Piano macio, baixo redondo e bateria leve para uma noite calma',
      mood: 'night',
      durationSeconds: 180,
    });

    expect(result.title.length).toBeGreaterThanOrEqual(3);
  });

  it.each([
    'Faça uma música no estilo de um artista famoso com piano e bateria',
    'Create a lo-fi track inspired by a famous singer with warm keys',
  ])('blocks imitation requests: %s', (prompt) => {
    expect(() => normalizeMusicPrompt({ prompt, durationSeconds: 180 })).toThrow(
      'Não posso imitar artistas',
    );
  });

  it('blocks vocal requests in the instrumental-only MVP', () => {
    expect(() => normalizeMusicPrompt({
      prompt: 'Uma faixa lo-fi com vocais suaves e letra romântica',
      durationSeconds: 180,
    })).toThrow('somente lo-fi instrumental');
  });

  it('redacts personal contact data before persistence and generation', () => {
    const result = normalizeMusicPrompt({
      prompt: 'Uma faixa calma para maria@example.com ouvir no telefone +55 11 99999-8888',
      durationSeconds: 180,
    });

    expect(result.originalPrompt).not.toContain('maria@example.com');
    expect(result.originalPrompt).not.toContain('99999-8888');
    expect(result.normalizedPrompt).toContain('[email removido]');
  });
});
