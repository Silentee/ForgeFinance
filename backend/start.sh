#!/usr/bin/env bash
# start.sh — Start the Forge Finance backend (uv)
# Run from the backend/ directory: ./start.sh
#
# Requires: uv  (https://docs.astral.sh/uv/getting-started/installation/)
#   Install: curl -LsSf https://astral.sh/uv/install.sh | sh

set -e

# Check uv is available
if ! command -v uv &>/dev/null; then
    echo "ERROR: uv is not installed or not on PATH."
    echo ""
    echo "Install it with:"
    echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
    echo ""
    echo "Then open a new terminal and re-run this script."
    exit 1
fi

# Copy .env template if no .env exists yet
if [ ! -f ".env" ] && [ -f ".env.template" ]; then
    echo "Creating .env from template..."
    cp .env.template .env
fi

# uv sync installs all dependencies and creates/updates the venv automatically.
# On subsequent runs this is near-instant if nothing changed.
echo "Syncing dependencies..."
uv sync

echo ""
echo "============================================================"
echo "  Forge Finance API starting..."
echo "  Local:    http://localhost:8001"
echo "  API docs: http://localhost:8001/docs"
echo ""
echo "  Press Ctrl+C to stop the server."
echo "============================================================"
echo ""

uv run uvicorn app.main:app --reload --port 8001 --host 0.0.0.0

