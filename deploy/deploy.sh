#!/bin/bash
set -e

echo "[TapeC] Pulling latest from origin/main..."
git pull origin main

echo "[TapeC] Rebuilding and restarting container..."
docker compose down && docker compose up -d --build

echo "[TapeC] Deploy complete."
docker compose ps