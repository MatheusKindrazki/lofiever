# TODO - Lofiever Implementation Roadmap

This document details the tasks required to build the Lofiever project, focusing on synchronized audio streaming and AI-powered dynamic playlist generation.

## Phase 1: Streaming Core Restructuring

**Objective:** Replace streaming simulation with a real 24/7 radio architecture where all users hear the same part of the music simultaneously.

- [x] **1.1. Configure Icecast Streaming Server:**
  - [x] Install Icecast on development server
  - [x] Configure sources and mount points in `icecast.xml`
  - [x] Secure admin and source access with passwords
  - [x] Test connection with audio client (e.g., VLC)

- [x] **1.2. Install and Configure Liquidsoap:**
  - [x] Install Liquidsoap on server
  - [x] Create basic `.liq` script to test Icecast connection
  - [x] Configure Liquidsoap to transcode audio to compatible format (Opus)
  - [x] Implement audio output to Icecast mount point (`output.icecast`)

- [x] **1.3. NTP Time Synchronization:**
  - [x] Configure server to sync with public NTP server

- [x] **1.4. (Optional) DASH Protocol:**
  - [x] Research DASH segmentation tools (Shaka Packager, Bento4)
  - [x] Generate dynamic `manifest.mpd`

## Phase 2: Dynamic Playlist Implementation

**Objective:** Create a system where songs are added dynamically by AI without interrupting the stream.

- [x] **2.1. Create Playlist Generation Service (Node.js):**
  - [x] Develop Node.js service as the radio "brain"
  - [x] Create REST API for Liquidsoap to request next song
  - [x] Implement AI recommendation engine integration

- [x] **2.2. Integrate Node.js with Liquidsoap:**
  - [x] Modify `.liq` script to use `request.dynamic`
  - [x] Make Liquidsoap call Node.js API for next track URL
  - [x] Implement fallbacks (emergency playlist) if API fails

- [x] **2.3. Add Smooth Transitions:**
  - [x] Use Liquidsoap's `add_smart_crossfade` for smooth crossfades

## Phase 3: AI Curation Engine

**Objective:** Build a recommendation engine that selects music based on audio characteristics.

- [x] **3.1. OpenAI Integration:**
  - [x] Configure OpenAI API for chat moderation
  - [x] Implement AI-powered message processing
  - [x] Create DJ personality for responses

- [ ] **3.2. Audio Feature Analysis (Future):**
  - [ ] Set up Python environment (`venv` or `conda`)
  - [ ] Install libraries: `pandas`, `scikit-learn`, `numpy`, `fastapi`

- [ ] **3.3. Train Clustering Model (K-Means) (Future):**
  - [ ] Obtain lofi music dataset with audio features
  - [ ] Normalize data using `StandardScaler`
  - [ ] Apply K-Means algorithm to cluster songs
  - [ ] Save trained model to `.pkl` file

- [ ] **3.4. Develop Recommendation API (FastAPI) (Future):**
  - [ ] Create endpoint that receives song/cluster as input
  - [ ] Implement logic to return random song from same cluster

## Phase 4: Frontend/Backend Integration

**Objective:** Complete integration of real-time features and modern UI.

- [x] **4.1. Real-time Player:**
  - [x] Implement HTML5 audio player with Icecast stream
  - [x] Add volume control
  - [x] Display current track info
  - [x] Add play/pause with stream sync

- [x] **4.2. Zen Mode:**
  - [x] Fullscreen immersive experience
  - [x] Animated canvas background (waves, particles)
  - [x] Audio visualizer reacting to music
  - [x] Fullscreen API integration

- [x] **4.3. Live Chat:**
  - [x] Socket.IO real-time messaging
  - [x] AI message moderation
  - [x] Pending message states (loading, error)

- [x] **4.4. Internationalization:**
  - [x] next-intl integration
  - [x] English and Portuguese translations

## Phase 5: Deployment and Monitoring

**Objective:** Deploy the architecture to production.

- [x] **5.1. Docker Configuration:**
  - [x] Create production Dockerfile
  - [x] Configure docker-compose for Coolify
  - [x] Set up health checks

- [ ] **5.2. CI/CD Setup:**
  - [ ] Create GitHub Actions pipeline
  - [ ] Automated testing
  - [ ] Automated deployment

- [ ] **5.3. Monitoring:**
  - [ ] Configure logging system
  - [ ] Set up alerts for service failures
  - [ ] Implement analytics dashboard

## Phase 6: Future Enhancements

- [ ] User authentication system
- [ ] Playlist voting/requests
- [ ] Multiple stream qualities
- [ ] Mobile app (React Native)
- [ ] Monetization features
- [ ] Social features (followers, favorites)
