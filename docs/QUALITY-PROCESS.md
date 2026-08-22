# Lofiever Track Quality Process

> Operational playbook for producing 300–400 original lo-fi instrumental tracks per cycle, using Matheus's musical references as **directional input** while avoiding improper imitation or copyright risk.

## 1. Goal & Constraints

- **Output**: original instrumental lo-fi tracks, titled, artist fixed as `Lofine DJ`.
- **Volume target**: 300–400 catalog-ready tracks per batch.
- **Constraint 1**: no artist names, trademarks, or protected melodies in prompts.
- **Constraint 2**: every released track must pass automatic + human gates.
- **Constraint 3**: catalog must stay diverse; near-duplicates are rejected.

## 2. Pipeline Overview

```
References ──▶ Attribute Analysis ──▶ Abstract Style Cards ──▶ Generate N/variations
                                                                    │
                                              ┌─────────────────────┘
                                              ▼
                                    Automated Scoring (audio + metadata)
                                              │
                         ┌────────────────────┼────────────────────┐
                         ▼                    ▼                    ▼
                 Copyright Gate      Similarity Gate       Technical Gate
                         │                    │                    │
                         └────────────────────┼────────────────────┘
                                              ▼
                                    Human Listening Sample
                                              │
                         ┌────────────────────┼────────────────────┐
                         ▼                    ▼                    ▼
                  Diversity / Dedup      Master / Normalize      Catalog Ingest
```

Each box is a gate with pass/fail criteria. Tracks that fail any gate are either reworked or archived.

## 3. Step 1 — Reference Intake

Matheus provides reference tracks / styles he enjoys.

**Required input**:
- Audio file or stable link (YouTube/Spotify/local) per reference.
- Optional free-text note: "I like the warmth", "I hate the hi-hat", "needs more vinyl crackle".

** intake form fields**:

| Field | Example | Use |
|-------|---------|-----|
| `referenceId` | `REF-001` | stable internal ID |
| `sourceUrl` | Spotify URI / YouTube URL / local path | ingest for analysis |
| `vibeNote` | "rainy evening, muffled drums" | human context |
| `doNotUse` | "no saxophone" | negative constraints |

## 4. Step 2 — Attribute Analysis

For every reference, extract these attributes. Store them in a `ReferenceProfile` record.

| Attribute | Tool / Method | Stored As |
|-----------|---------------|-----------|
| BPM | Beat tracking (librosa / aubio) | integer |
| Key | Key detection (Krumhansl-Schmuckler / librosa) | e.g. `D minor` + confidence |
| Duration | ffprobe / librosa | seconds |
| Loudness (LUFS) | ffmpeg ebur128 | integrated LUFS |
| True peak | ffmpeg ebur128 | dBTP |
| Dynamic range | crest factor / PLR | float |
| Instrumentation | PANNs / YAMNet classifier tag list | array of tags |
| Texture | spectral centroid, bandwidth, rolloff | floats |
| Structure | segment boundaries (MFCC self-similarity) | intro/verse/chorus timestamps |
| Mood / valence | musicnn / manual tag | string |
| Repetition score | chroma recurrence matrix entropy | float (low = repetitive) |

## 5. Step 3 — Abstract Style Cards

Style cards are the **only** artifact fed into generation prompts. They deliberately omit artist names.

Each card is a JSON object derived from a cluster of similar reference profiles.

```json
{
  "styleCardId": "SC-LOFI-001",
  "name": "Warm Vinyl Evening",
  "derivedFrom": ["REF-001", "REF-003"],
  "isAbstract": true,
  "generationPrompt": {
    "genre": "instrumental lo-fi hip hop",
    "tempo": "72 BPM",
    "key": "D minor",
    "mood": "nostalgic, cozy, late night",
    "instruments": ["muffled upright bass", "dusty Rhodes", "soft boom-bap drums", "vinyl crackle", "rain ambience"],
    "structure": "8 bar intro / 16 bar A / 16 bar B / 8 bar outro",
    "dynamics": "quiet intro, gentle lift at B, fade-out outro",
    "texture": "warm low-mids, rolled-off highs, subtle saturation",
    "exclude": ["vocals", "saxophone", "sharp transients", "electronic arpeggios"]
  },
  "targetMetrics": {
    "bpm": 72,
    "bpmTolerance": 3,
    "durationSeconds": [150, 225],
    "targetLufs": -14.0,
    "maxTruePeakDbTp": -1.0,
    "minDynamicRangeDb": 8.0
  }
}
```

**Clustering rule**: group references by cosine similarity of their attribute vectors. One style card per cluster. Do not create cards from single references unless the reference is unique enough to justify a new cluster.

## 6. Step 4 — Multi-Generation

For each style card, generate **N = 10** candidate tracks.

- Use only a provider approved by the current architecture RFC and its license gate. The initial
  shortlist is ACE-Step 1.5 **only after the local spike passes**, with Google Lyria as the API
  fallback. DiffRhythm2 is a research challenger; MusicGen is ineligible because its official
  weights are non-commercial. Suno/Udio wrappers are not approved providers.
- Always use **Custom Mode** if available; keep lyrics empty (instrumental) or use `[Instrumental]` tags.
- Generation provider must be configured to refuse prompts containing artist names or trademarks (pre-filter).
- Each candidate gets a unique `generationId` and is stored in cold storage (S3/R2) with metadata.

**Suggested filename pattern**:
```
{styleCardId}/{generationId}/{trackId}_draft.wav
```

## 7. Step 5 — Automated Scoring

Run every generated track through the scoring harness. Output a `TrackScore` record.

| Metric | Target | Reject If | Why |
|--------|--------|-----------|-----|
| **Duration** | 150–184 s | < 145 s or > 190 s | aligned with the current fail-closed validator and Lyria ceiling |
| **Integrated LUFS** | -14.0 ± 1.0 | outside -16 to -12 | platform loudness norm |
| **True peak** | ≤ -1.0 dBTP | > -0.5 dBTP | clipping, downstream distortion |
| **Dynamic range / PLR** | ≥ 8 LU | < 5 LU | too crushed or too variable |
| **BPM match** | within ±3 of style card | > ±5 | style drift |
| **Key match confidence** | ≥ 0.6 | < 0.4 | harmonic incoherence |
| **Reference cosine similarity** | < 0.80 | ≥ 0.88 | too close to original references |
| **Catalog cosine similarity** | < 0.82 nearest neighbor | ≥ 0.90 | near-duplicate of existing track |
| **Internal repetition** | entropy 0.4–0.8 | < 0.25 | over-looped / static |
| **Silence / dead air** | < 2 s lead/trail | > 5 s | bad broadcast experience |
| **Clipping events** | 0 | > 3 | technical defect |

**Audio embedding model**: CLAP or a music-specific embedding (e.g., Microsoft CLAP, Laion-CLAP, or MERT). Use the same model for reference, catalog, and generated tracks to keep distances comparable.

These similarity thresholds are **initial estimates**, not universal constants. Calibrate them on
the 50-generation pilot and version them with the embedding model and revision. Scores between the
target and reject thresholds require human review.

**Eligibility and ranking**:
```
# Eligibility is fail-closed and non-compensable:
eligible = technicalPass && referenceSimilarityPass && catalogSimilarityPass && fingerprintPass

# Only rank candidates that are already eligible. Every term is normalized to [0, 1].
qualityScore = 0.45 * humanRating01
             + 0.25 * (1 - referenceSimilarity01)
             + 0.20 * (1 - catalogSimilarity01)
             + 0.10 * technicalMargin01
```

`qualityScore` never overrides a failed gate. It only orders eligible candidates for listening,
deduplication, and promotion. When no human review exists, `humanRating01 = 0.5` (neutral); the
pilot calibrates the ranking weights before production.

## 8. Step 6 — Human Listening Gates

Human ears catch what embeddings miss (artifacts, annoying loops, wrong mood).

**Sampling strategy (scalable to 400)**:

| Stage | Human Listen % | Population |
|-------|----------------|------------|
| Pilot | 100 % | all 50 generated candidates |
| Production batch | 30 % | stratified: 100% of first batch in a new style card, 20% of stable style cards |
| Auto-escalation | 100 % | any automatic flag (similarity > 0.80, clipping, key mismatch, low entropy) |
| Random audit | 5 % | sample from auto-approved tracks |

**Human rating form**:
- 1–5 on: mood fit, production quality, originality, listenability, no artifacts.
- Binary: would release? / copyright concern? / too repetitive?

**Pass rule**: average score ≥ 3.5 and at least 3 of 5 dimensions ≥ 4.0.

## 9. Step 7 — Diversity / Deduplication

Before mastering, run a catalog deduplication pass.

1. **Embedding cluster**: build a FAISS / Annoy index of all accepted tracks + catalog.
2. **Build a graph**: connect candidates in the review band; reject edges use cosine similarity
   ≥ 0.90 (initial estimate; calibrate and version with the embedding model).
3. **Resolve each connected component deterministically**: sort by
   `(qualityScore desc, generationId asc)`, keep the first, and archive the rest with the survivor's
   ID as the reason. Do not resolve pairs independently; pair order must not change the result.
4. **Style coverage check**: ensure no style card dominates > 30 % of the batch. Re-balance if needed.
5. **Diversity metric**: compute silhouette score of the batch using style-card labels. Target > 0.25. Below 0.15 = reject batch.

## 10. Step 8 — Mastering & Normalization

Liquidsoap already applies light normalization at stream time, but source files should be consistent.

**Mastering chain**:
1. Trim lead/trail silence to ≤ 300 ms.
2. Target **-14 LUFS integrated** with **-1 dBTP true peak**.
3. Light EQ: roll off sub-40 Hz rumble, tame harsh 3–5 kHz if needed.
4. Optional: add final vinyl/rain layer only if missing and desired by style card.
5. Export as **48 kHz / 24-bit WAV** (archive) and **44.1 kHz / 320 kbps MP3** (stream).

**Validation after mastering**: re-run LUFS, true peak, clipping, and duration checks.

## 11. Step 9 — Catalog Ingestion

Insert accepted tracks into the Lofiever database.

**Required fields**:
- `title`: unique, mandatory.
- `artist`: always `Lofine DJ`.
- `sourceType`: `s3` or `local`.
- `sourceId`: S3/R2 key.
- `artworkKey`: generated or default cover.
- `duration`: seconds.
- `bpm`: from analysis.
- `mood`: from style card.

**Recommended schema additions** (track table):
- `key`, `styleCardId`, `referenceIds`, `generationPromptHash`, `qualityScore`, `embeddingVector`, `masterHash`, `copyrightStatus`, `reviewedBy`.

## 12. Copyright & Sampling Gates

This is a **blocking** gate, not a scoring gate.

### 12.1 Input-level protection
- Pre-filter prompts for artist names, band names, song titles, trademarks.
- Style cards must be validated: no names, only abstract descriptors.
- Maintain a `BANNED_TOKENS` list and reject generation if matched.

### 12.2 Output-level checks
1. **Acoustic fingerprint** against references and a curated commercial corpus using Chromaprint / AcoustID.
2. **Embedding similarity** to references enters human review at ≥ 0.80 and is rejected at ≥ 0.88
   (initial estimates; calibrate and version with the embedding model).
3. **Perceptual hash** of mel-spectrogram to catch near-copies.
4. **Third-party detection** (e.g., AudD, Shazam API) on the final master for high-confidence tracks.

### 12.3 Sample-based generation
If the generator uses audio samples (not text-to-audio), log every sample source, confirm royalty-free / cleared / original, and flag for manual review.

### 12.4 Disposition
| Result | Action |
|--------|--------|
| Clean | proceed |
| Similar to reference but below threshold | note in `copyrightStatus`, keep for human review |
| Match to commercial recording | reject and archive |
| Unclear / borderline | escalate to Matheus; do not release until resolved |

## 13. Operational Cadence

**Initial planning unit**: 50 candidate generations per week — not 50 approved tracks.

**Weekly workflow**:
1. Monday: collect references, generate style cards.
2. Tuesday–Wednesday: generate 10 candidates per card.
3. Thursday: automated scoring + copyright gate.
4. Friday: human listening + deduplication.
5. Weekend: master + ingest.

**Capacity is yield-dependent.** With the initial gates below, the illustrative compound yield is
`0.70 × 0.80 × 0.85 = 0.476`, so 50 generations produce about 24 approved tracks and 400 approved
tracks require about 840 generations, or 16.8 weeks at 50 generations/week. This is a derived
planning scenario, not a commitment; replace it with measured pilot yield before scheduling the
campaign.

## 14. Pilot Recommendation

**Pilot scope**: 50 candidate generations (the number of approved tracks is an output).

- 5 style cards.
- 10 generations per card.
- 100 % human review.
- 100 % copyright detection.

### Go / No-Go Criteria

**Go** (proceed to full 400-track production) if **all** are true:
- ≥ 70 % of generated tracks pass the automated scoring gate.
- ≥ 80 % of human-reviewed tracks are rated release-ready.
- 0 % third-party copyright matches.
- ≤ 5 % flagged as similar to a reference.
- Catalog deduplication rejects ≤ 15 % of accepted tracks.
- Silhouette diversity score ≥ 0.25.
- Mastering pipeline hits LUFS target on ≥ 95 % of tracks.

**No-Go** (stop and iterate the process) if **any** are true:
- > 5 % copyright / melody matches.
- > 30 % human rejection rate.
- Style cards collapse into one cluster (silhouette < 0.15).
- Reference embedding distance is consistently > 0.85 (style cards are too literal).
- Technical gate failure > 30 % (clipping, duration, LUFS).

### Pilot output
A `PILOT_REPORT.md` with:
- distribution of scores,
- rejected tracks and reason codes,
- approved tracks list,
- style-card effectiveness,
- recommended changes before full run.

## 15. Tooling Recommendations

| Function | Tool | Notes |
|----------|------|-------|
| Analysis | `librosa`, `aubio`, `ffmpeg`, `essentia` | BPM, key, structure, texture |
| Embeddings | CLAP or MERT after license/version review | consistent model and revision across pipeline |
| Similarity search | FAISS, Annoy, pgvector | catalog dedup |
| Fingerprinting | Chromaprint / AcoustID | copyright gate |
| Mastering | `ffmpeg` loudnorm, `sox`, `pydub` | automated chain |
| Storage | S3 / R2 | draft + master + archive |
| Database | PostgreSQL + pgvector | embedding index |
| Workflow | Python pipeline + GitHub Actions | run on new batch |

## 16. Quick-Start Checklist

- [ ] Define reference intake form.
- [ ] Set up analysis harness (BPM/key/LUFS/texture).
- [ ] Build style-card validator (no artist names).
- [ ] Connect generation provider.
- [ ] Implement scoring harness with thresholds above.
- [ ] Add copyright gate (fingerprint + embedding).
- [ ] Build human-listening UI or spreadsheet.
- [ ] Build deduplication pipeline.
- [ ] Automate mastering chain.
- [ ] Run 50-track pilot and produce `PILOT_REPORT.md`.

## 17. Appendix A — Example Style Card JSON

See Section 5 for the main example. Keep cards under 1,200 characters for prompt fields to avoid confusing the generator.

## 18. Appendix B — Suggested Prisma Additions

```prisma
model Track {
  // ...existing fields...
  key              String?
  styleCardId      String?
  referenceIds     String[]  // e.g. ["REF-001"]
  qualityScore     Float?
  embeddingVector  Unsupported("vector(512)")? // pgvector
  copyrightStatus  String    @default("pending")
  reviewedBy       String?
  masterHash       String?
  generationPrompt Json?
}
```

---

*This document is a living process. Update thresholds after the pilot based on real data.*
