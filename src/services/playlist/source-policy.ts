import type { Prisma } from '@prisma/client';
import { config } from '@/lib/config';

/**
 * Fontes garantidamente tocáveis sem depender do YouTube/yt-dlp.
 * R2 (s3) é a fonte primária do catálogo de produção; `local` e `r2`
 * cobrem arquivos servidos diretamente. Estas fontes NUNCA dependem de
 * resolução externa frágil, então a rádio nunca fica sem próxima faixa.
 */
export const PLAYABLE_SOURCE_TYPES = ['r2', 's3', 'local'] as const;

export type PlayableSourceType = (typeof PLAYABLE_SOURCE_TYPES)[number];

/**
 * Retorna a lista de sourceTypes permitidos para seleção de faixa.
 * Inclui `'youtube'` SOMENTE quando o YouTube está habilitado por config;
 * caso contrário, restringe ao whitelist garantidamente tocável.
 */
export function getAllowedSourceTypes(): string[] {
  const allowed: string[] = [...PLAYABLE_SOURCE_TYPES];
  if (config.youtube.enabled) {
    allowed.push('youtube');
  }
  return allowed;
}

/**
 * Filtro Prisma de sourceType para queries de faixa. Sempre aplicável
 * (mesmo em caminhos relaxados) para que linhas 'youtube' nunca vazem
 * de volta quando o YouTube está desabilitado.
 */
export function getSourceTypeFilter(): Prisma.TrackWhereInput {
  return { sourceType: { in: getAllowedSourceTypes() } };
}

/**
 * Indica se um sourceType é garantidamente tocável sem depender do YouTube.
 */
export function isPlayableSourceType(sourceType: string): boolean {
  return (PLAYABLE_SOURCE_TYPES as readonly string[]).includes(sourceType);
}
