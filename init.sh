#!/usr/bin/env bash
# init.sh — AmbientPixels loop scaffold initializer
# Idempotent: safe to run multiple times.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "=== AmbientPixels init ==="
echo "Project dir: $PROJECT_DIR"

# --- 1. Install dependencies ---
echo ""
echo "[1/3] Installing dependencies..."
cd "$PROJECT_DIR"
if [ -d node_modules ]; then
  echo "  node_modules exists, skipping npm install (run 'npm install' manually to update)"
else
  npm install --no-audit --no-fund
fi

# --- 2. Environment check ---
echo ""
echo "[2/3] Checking environment..."

# Node.js version
NODE_VER=$(node -v)
echo "  Node.js: $NODE_VER"

# Check for required env vars (placeholders — fill in local.settings.json)
if [ -f "$PROJECT_DIR/local.settings.json" ]; then
  echo "  local.settings.json: found"
else
  echo "  local.settings.json: MISSING (copy from template or create manually)"
  echo "  Required keys: GEMINI_API_KEY, AZURE_STORAGE_CONNECTION_STRING, COMPANY_SECRET"
fi

# --- 3. Health check: build ---
echo ""
echo "[3/3] Running health check..."

BUILD_OK=true
TEST_OK=true

# Build: site manifest
if npm run build:site-manifest 2>&1 | tail -1 | grep -q "Done"; then
  echo "  Build (site-manifest): PASS"
else
  echo "  Build (site-manifest): FAIL"
  BUILD_OK=false
fi

# Test: no test suite exists yet
echo "  Tests: NONE (no test script defined in package.json)"
TEST_OK="N/A"

# Validate function.json files are parseable (use node script to avoid path issues on Windows)
FUNC_RESULT=$(node -e "
  const fs = require('fs'), path = require('path');
  const apiDir = path.join(process.argv[1], 'api');
  let fail = 0, total = 0;
  for (const d of fs.readdirSync(apiDir)) {
    const fp = path.join(apiDir, d, 'function.json');
    if (!fs.existsSync(fp)) continue;
    total++;
    try { JSON.parse(fs.readFileSync(fp, 'utf8')); }
    catch { fail++; console.error('  INVALID: ' + d + '/function.json'); }
  }
  console.log(fail === 0 ? 'PASS:' + total : 'FAIL:' + fail + ':' + total);
" "$PROJECT_DIR" 2>&1)
FUNC_ERRORS=$(echo "$FUNC_RESULT" | grep "INVALID" || true)
FUNC_STATUS=$(echo "$FUNC_RESULT" | tail -1)
if [ -n "$FUNC_ERRORS" ]; then echo "$FUNC_ERRORS"; fi
if echo "$FUNC_STATUS" | grep -q "^PASS"; then
  TOTAL=$(echo "$FUNC_STATUS" | cut -d: -f2)
  echo "  function.json validation: PASS ($TOTAL files)"
else
  echo "  function.json validation: FAIL ($(echo "$FUNC_STATUS" | cut -d: -f2) of $(echo "$FUNC_STATUS" | cut -d: -f3) invalid)"
  BUILD_OK=false
fi

# --- Summary ---
echo ""
if [ "$BUILD_OK" = true ]; then
  echo "PASS"
else
  echo "FAIL"
fi
