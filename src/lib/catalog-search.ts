import { searchTracks } from '@/lib/api';
import type { CatalogTrack, SearchTracksOptions, TrackSearchResponse } from '@/lib/api';

type CatalogSearch = (
  query: string,
  options?: SearchTracksOptions,
) => Promise<TrackSearchResponse>;

export interface CatalogSearchResult {
  tracks: CatalogTrack[];
  exactTotal: number;
  isFallback: boolean;
}

const uniqueTracks = (tracks: CatalogTrack[]): CatalogTrack[] => {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    const key = `${track.title.trim().toLocaleLowerCase()}::${track.artist.trim().toLocaleLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export async function searchCatalogWithFallback(
  query: string,
  search: CatalogSearch = searchTracks,
): Promise<CatalogSearchResult> {
  const options = { limit: 20, offset: 0 };
  const direct = await search(query, options);
  const directTracks = uniqueTracks(direct.tracks);

  if (directTracks.length > 0 || !query.trim()) {
    return {
      tracks: directTracks,
      exactTotal: directTracks.length,
      isFallback: false,
    };
  }

  const suggestions = await search('', options);
  return {
    tracks: uniqueTracks(suggestions.tracks),
    exactTotal: 0,
    isFallback: true,
  };
}
