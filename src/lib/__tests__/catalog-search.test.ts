import type { CatalogTrack, TrackSearchResponse } from '@/lib/api';
import { searchCatalogWithFallback } from '@/lib/catalog-search';

const track = (id: string, title: string, artist: string): CatalogTrack => ({
  id,
  title,
  artist,
  sourceType: 's3',
  duration: 120,
  bpm: null,
  mood: 'Lo-Fi',
});

const response = (tracks: CatalogTrack[], total = tracks.length): TrackSearchResponse => ({
  tracks,
  meta: { total, limit: 20, offset: 0 },
});

describe('searchCatalogWithFallback', () => {
  it('shows unique catalog suggestions when there is no exact match', async () => {
    const search = jest
      .fn()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(
        response([
          track('1', 'Nighttime Stroll', 'Artificial.Music'),
          track('2', 'Nighttime Stroll', 'Artificial.Music'),
          track('3', 'Woods', 'Ambulo'),
        ]),
      );

    const result = await searchCatalogWithFallback('piano', search);

    expect(search).toHaveBeenNthCalledWith(1, 'piano', { limit: 20, offset: 0 });
    expect(search).toHaveBeenNthCalledWith(2, '', { limit: 20, offset: 0 });
    expect(result.isFallback).toBe(true);
    expect(result.exactTotal).toBe(0);
    expect(result.tracks.map((item) => item.id)).toEqual(['1', '3']);
  });

  it('keeps direct results and does not load suggestions when matches exist', async () => {
    const search = jest.fn().mockResolvedValue(
      response([track('1', 'And So It Begins', 'Artificial.Music')], 1),
    );

    const result = await searchCatalogWithFallback('Artificial.Music', search);

    expect(search).toHaveBeenCalledTimes(1);
    expect(result.isFallback).toBe(false);
    expect(result.exactTotal).toBe(1);
    expect(result.tracks).toHaveLength(1);
  });
});
