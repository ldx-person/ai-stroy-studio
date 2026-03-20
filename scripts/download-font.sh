#!/bin/bash
# Download Noto Sans SC font for PDF export
# Usage: bash scripts/download-font.sh

FONT_DIR="public/fonts"
FONT_URL="https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf"
FONT_FILE="$FONT_DIR/NotoSansSC-Regular.ttf"

mkdir -p "$FONT_DIR"

if [ -f "$FONT_FILE" ]; then
  echo "Font file already exists: $FONT_FILE"
  exit 0
fi

echo "Downloading Noto Sans SC font..."
curl -L -o "$FONT_FILE" "$FONT_URL"

if [ $? -eq 0 ] && [ -f "$FONT_FILE" ]; then
  echo "Font downloaded successfully: $FONT_FILE"
else
  echo "Failed to download font."
  exit 1
fi
