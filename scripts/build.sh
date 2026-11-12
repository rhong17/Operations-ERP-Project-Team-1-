#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/build.mjs
rm -rf dist
mkdir -p dist/server dist/.openai/drizzle
cp worker/index.js dist/server/index.js
cp .openai/hosting.json dist/.openai/hosting.json
cp -r drizzle/. dist/.openai/drizzle/
