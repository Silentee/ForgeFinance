#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="$ROOT_DIR/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/app_$TIMESTAMP.db"

mkdir -p "$BACKUP_DIR"

echo "Copying database from Docker volume..."
docker run --rm \
  -v forgefinance_forge-data:/data \
  -v "$BACKUP_DIR":/backup \
  alpine cp /data/app.db "/backup/app_$TIMESTAMP.db"

echo "Backup saved to $BACKUP_FILE"

