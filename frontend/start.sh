#!/usr/bin/env bash
# start.sh — Start the Forge Finance frontend
set -e

if ! command -v node &>/dev/null; then
    echo "ERROR: Node.js not found. Install from https://nodejs.org/"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

if [ ! -f ".env.local" ] && [ -f ".env.template" ]; then
    echo "Creating .env.local from template..."
    cp .env.template .env.local
fi

echo ""
echo "Forge Finance frontend starting at http://localhost:5173"
echo "Make sure the backend is running: cd ../backend && ./start.sh"
echo ""
npm run dev

