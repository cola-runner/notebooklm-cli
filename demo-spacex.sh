#!/usr/bin/env bash
#
# End-to-end demo: build a SpaceX notebook from real web sources (YouTube
# videos + Wikipedia articles), generate an Audio Overview (podcast), and
# download it. Requires a logged-in session first:  node dist/cli/index.js login
#
set -euo pipefail

CLI="node $(dirname "$0")/dist/cli/index.js"
OUT="${OUT:-./spacex-podcast.mp4}"

echo "==> 0. Auth check"
$CLI status

echo; echo "==> 1. Create notebook"
NB=$($CLI create "SpaceX 资料库" | awk '/^Created:/{print $2}')
echo "    notebook id = $NB"

echo; echo "==> 2. Add sources (2 YouTube videos + 2 Wikipedia articles), waiting for each to process"
$CLI source add "$NB" --url "https://www.youtube.com/watch?v=Zi2SU98BAD8" --wait   # Starship Flight 12 (full)
$CLI source add "$NB" --url "https://www.youtube.com/watch?v=4PuyU9i3-R4" --wait   # Flight Test 12 in 11 min
$CLI source add "$NB" --url "https://en.wikipedia.org/wiki/SpaceX" --wait
$CLI source add "$NB" --url "https://en.wikipedia.org/wiki/SpaceX_Starship" --wait

echo; echo "==> 3. Sources in the notebook"
$CLI source list "$NB"

echo; echo "==> 4. Generate Audio Overview (deep-dive) — blocks until ready (can take several minutes)"
$CLI generate audio "$NB" --format deep-dive \
  --instructions "Focus on Starship's Flight 12 test and SpaceX's path to Mars." \
  --wait --timeout 900

echo; echo "==> 5. Artifacts in the notebook"
$CLI artifact list "$NB"

echo; echo "==> 6. Download the podcast to $OUT"
$CLI download audio "$NB" "$OUT"

echo; echo "==> Done. Saved podcast to $OUT"
ls -lh "$OUT"
