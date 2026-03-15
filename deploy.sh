#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Pulling latest changes..."
git pull

echo "Building and starting containers..."
docker compose up --build -d

LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo "unknown")
echo "Done. Frontend available at:"
echo "  http://localhost:8080"
echo "  http://$LOCAL_IP:8080"
