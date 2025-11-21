// src/services/playlist/playlist-manager.service.test.ts
import { PlaylistManagerService } from './playlist-manager.service';
import { DatabaseService } from '@/services/database';
import { prisma } from '@/lib/prisma';
import type { Playlist, Track, PlaylistTrack } from '@prisma/client';

// Mock das dependências
jest.mock('@/services/database', () => ({
  DatabaseService: {
    getActivePlaylist: jest.fn(),
    invalidatePlaylistCache: jest.fn(),
  },
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    track: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    playlistTrack: {
      create: jest.fn(),
    },
  },
}));

// Mocks tipados para facilitar o uso
const mockedDatabaseService = DatabaseService as jest.Mocked<typeof DatabaseService>;
const mockedPrisma = prisma as jest.Mocked<typeof prisma>;

// Dados de teste
const track1: Track = { id: 'track1', title: 'A', artist: 'X', sourceType: 'local', sourceId: 'a.mp3', duration: 180, bpm: 80, mood: 'chill', createdAt: new Date(), updatedAt: new Date(), lastPlayed: null };
const track2: Track = { id: 'track2', title: 'B', artist: 'Y', sourceType: 'local', sourceId: 'b.mp3', duration: 200, bpm: 90, mood: 'relaxed', createdAt: new Date(), updatedAt: new Date(), lastPlayed: null };
const track3: Track = { id: 'track3', title: 'C', artist: 'Z', sourceType: 'local', sourceId: 'c.mp3', duration: 220, bpm: 100, mood: 'happy', createdAt: new Date(), updatedAt: new Date(), lastPlayed: null };

const testPlaylist: Playlist & { tracks: (PlaylistTrack & { track: Track })[] } = {
  id: 'playlist1',
  version: 1,
  active: true,
  createdAt: new Date(),
  tracks: [
    { playlistId: 'playlist1', trackId: 'track1', position: 1, addedBy: 'seed', addedAt: new Date(), track: track1 },
    { playlistId: 'playlist1', trackId: 'track2', position: 2, addedBy: 'seed', addedAt: new Date(), track: track2 },
    { playlistId: 'playlist1', trackId: 'track3', position: 3, addedBy: 'seed', addedAt: new Date(), track: track3 },
  ],
};

describe('PlaylistManagerService', () => {
  beforeEach(() => {
    // Limpa os mocks antes de cada teste
    jest.clearAllMocks();
  });

  describe('getNextTrack', () => {
    it('should return the next track in the playlist', async () => {
      mockedDatabaseService.getActivePlaylist.mockResolvedValue(testPlaylist);
      const nextTrack = await PlaylistManagerService.getNextTrack('track1');
      expect(nextTrack).toEqual(track2);
    });

    it('should wrap around to the first track if the current one is the last', async () => {
      mockedDatabaseService.getActivePlaylist.mockResolvedValue(testPlaylist);
      const nextTrack = await PlaylistManagerService.getNextTrack('track3');
      expect(nextTrack).toEqual(track1);
    });

    it('should return the first track if no current track is provided', async () => {
      mockedDatabaseService.getActivePlaylist.mockResolvedValue(testPlaylist);
      const nextTrack = await PlaylistManagerService.getNextTrack();
      expect(nextTrack).toEqual(track1);
    });

    it('should return the first track if the current track is not in the playlist', async () => {
      mockedDatabaseService.getActivePlaylist.mockResolvedValue(testPlaylist);
      const nextTrack = await PlaylistManagerService.getNextTrack('track-not-found');
      expect(nextTrack).toEqual(track1);
    });

    it('should return a fallback track if the playlist is empty', async () => {
      const emptyPlaylist = { ...testPlaylist, tracks: [] };
      mockedDatabaseService.getActivePlaylist.mockResolvedValue(emptyPlaylist);
      mockedPrisma.track.findMany.mockResolvedValue([{ id: 'track1' }]);
      mockedPrisma.track.findUnique.mockResolvedValue(track1);
      
      const fallbackTrack = await PlaylistManagerService.getNextTrack();
      
      expect(fallbackTrack).toEqual(track1);
      expect(mockedPrisma.track.findMany).toHaveBeenCalled();
    });
  });

  describe('addTrackToPlaylist', () => {
    it('should add a track to the end of the playlist', async () => {
      mockedDatabaseService.getActivePlaylist.mockResolvedValue(testPlaylist);
      
      await PlaylistManagerService.addTrackToPlaylist('new-track', 'ai-curator');

      expect(mockedPrisma.playlistTrack.create).toHaveBeenCalledWith({
        data: {
          playlistId: 'playlist1',
          trackId: 'new-track',
          position: 4, // 3 (max position) + 1
          addedBy: 'ai-curator',
        },
      });
      expect(mockedDatabaseService.invalidatePlaylistCache).toHaveBeenCalled();
    });

    it('should throw an error if there is no active playlist', async () => {
      mockedDatabaseService.getActivePlaylist.mockResolvedValue(null);
      
      await expect(
        PlaylistManagerService.addTrackToPlaylist('new-track', 'ai-curator')
      ).rejects.toThrow('Nenhuma playlist ativa para adicionar a faixa.');
    });
  });
});
