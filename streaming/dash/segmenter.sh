#!/bin/sh
# Simple script to segment Icecast stream to DASH using ffmpeg
# Requires ffmpeg installed

ICECAST_URL="http://localhost:8000/stream"
OUTPUT_DIR="./dash-output"
MPD_NAME="manifest.mpd"

mkdir -p "$OUTPUT_DIR"

ffmpeg -y -i "$ICECAST_URL" \
  -c:a copy -f dash \
  -min_seg_duration 1000000 \
  -use_timeline 1 -use_template 1 \
  "$OUTPUT_DIR/$MPD_NAME"
