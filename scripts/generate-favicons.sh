#!/bin/bash

# Script to generate favicon PNG files from SVG
# Requires: ImageMagick or sharp-cli

echo "Generating favicons from SVG..."

# Check if we have ImageMagick
if command -v convert &> /dev/null; then
    echo "Using ImageMagick..."

    cd public

    # Generate PNG favicons from icon.svg
    convert -background none icon.svg -resize 16x16 favicon-16x16.png
    convert -background none icon.svg -resize 32x32 favicon-32x32.png
    convert -background none icon.svg -resize 180x180 apple-touch-icon.png
    convert -background none icon.svg -resize 192x192 icon-192.png
    convert -background none icon.svg -resize 512x512 icon-512.png
    convert -background none icon.svg -resize 70x70 icon-70.png
    convert -background none icon.svg -resize 150x150 icon-150.png
    convert -background none icon.svg -resize 310x310 icon-310.png

    # Generate OG image from SVG
    convert -background none og-image.svg -resize 1200x630 og-image.png
    convert -background none icon.svg -resize 600x600 og-image-square.png

    # Generate logo
    convert -background none icon.svg -resize 512x512 logo.png

    # Generate ICO file (multi-resolution)
    convert favicon-16x16.png favicon-32x32.png -colors 256 favicon.ico

    echo "Done! Generated all favicon files."

else
    echo "ImageMagick not found. Please install it:"
    echo "  macOS: brew install imagemagick"
    echo "  Ubuntu: sudo apt-get install imagemagick"
    echo ""
    echo "Or use an online tool like:"
    echo "  https://realfavicongenerator.net/"
    echo "  https://favicon.io/favicon-converter/"
    echo ""
    echo "Upload public/icon.svg to generate:"
    echo "  - favicon-16x16.png"
    echo "  - favicon-32x32.png"
    echo "  - apple-touch-icon.png (180x180)"
    echo "  - icon-192.png"
    echo "  - icon-512.png"
    echo "  - favicon.ico"
    echo ""
    echo "And upload public/og-image.svg to generate:"
    echo "  - og-image.png (1200x630)"
fi
