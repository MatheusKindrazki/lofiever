import { PlaylistManagerService } from './playlist-manager.service';

export const LiquidsoapIntegrationService = {
  async handleNextTrackRequest(current?: string): Promise<string> {
    const url = await PlaylistManagerService.getNextTrack(current);
    return url;
  },
};
