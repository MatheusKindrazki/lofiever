#!/bin/sh

set -eu

if ! command -v magick >/dev/null 2>&1 || ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "ImageMagick and librsvg are required to regenerate the store artwork." >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(dirname "$SCRIPT_DIR")
SOURCE_ROOT="$PROJECT_ROOT/assets/store"
GENERATED_ROOT="$SOURCE_ROOT/generated"
IMAGE_ROOT="$PROJECT_ROOT/assets/images"

mkdir -p "$GENERATED_ROOT"

for layer in back middle front; do
  rsvg-convert --width 1280 --height 768 "$SOURCE_ROOT/app-icon-$layer.svg" --output "$GENERATED_ROOT/app-icon-$layer-1280x768.png"
  rsvg-convert --width 800 --height 480 "$SOURCE_ROOT/app-icon-$layer.svg" --output "$GENERATED_ROOT/app-icon-$layer-800x480.png"
  rsvg-convert --width 400 --height 240 "$SOURCE_ROOT/app-icon-$layer.svg" --output "$GENERATED_ROOT/app-icon-$layer-400x240.png"
done

magick \
  "$GENERATED_ROOT/app-icon-back-1280x768.png" \
  "$GENERATED_ROOT/app-icon-middle-1280x768.png" -compose over -composite \
  "$GENERATED_ROOT/app-icon-front-1280x768.png" -compose over -composite \
  "$IMAGE_ROOT/icon-1280x768.png"

magick "$IMAGE_ROOT/icon-1280x768.png" -resize 800x480\! "$IMAGE_ROOT/icon-800x480.png"
magick "$IMAGE_ROOT/icon-1280x768.png" -resize 400x240\! "$IMAGE_ROOT/icon-400x240.png"

rsvg-convert --width 1920 --height 720 "$SOURCE_ROOT/top-shelf.svg" --output "$IMAGE_ROOT/icon-1920x720.png"
rsvg-convert --width 3840 --height 1440 "$SOURCE_ROOT/top-shelf.svg" --output "$IMAGE_ROOT/icon-3840x1440.png"
rsvg-convert --width 2320 --height 720 "$SOURCE_ROOT/top-shelf-wide.svg" --output "$IMAGE_ROOT/icon-2320x720.png"
rsvg-convert --width 4640 --height 1440 "$SOURCE_ROOT/top-shelf-wide.svg" --output "$IMAGE_ROOT/icon-4640x1440.png"

echo "Store artwork regenerated. Run npm run store:assets after Expo Prebuild."
