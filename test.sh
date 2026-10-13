#!/usr/bin/env bash
# Run all tests in one go:
#
#   ./test.sh
#
# Serve the repository root with a static server, as the hosting service will,
# start headless Chrome and run the suites. Close everything on exit,
# regardless of what remains, and exit with 0 when all suites pass.
#
# `tests/wall-faces.js` tests pure geometry and needs no browser. The remaining
# suites drive a real Chrome browser through the DevTools protocol, the only
# way to test clicks and keys in the app.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find the first installed command from the list, or report what is missing.
# This avoids starting halfway and failing with an unrelated error.
findCommand() {
  for command in "$@"; do command -v "$command" >/dev/null 2>&1 && { echo "$command"; return; }; done
  echo "test.sh: requires one of these commands, but none is installed: $*" >&2
  exit 1
}

NODE=$(findCommand node)
PYTHON=$(findCommand python3)
CURL=$(findCommand curl)
CHROME=$(findCommand google-chrome-stable google-chrome chromium chromium-browser)

findFreePort() { "$PYTHON" -c "import socket;connection=socket.socket();connection.bind(('',0));print(connection.getsockname()[1]);connection.close()"; }

WEB_PORT=$(findFreePort)
CDP_PORT=$(findFreePort)
TEMP_DIRECTORY=$(mktemp -d)
WEB_PROCESS_ID=""
CHROME_PROCESS_ID=""

# Chrome children keep writing to the profile briefly after kill, preventing
# removal of the temporary directory until they stop. Retry removal rather
# than attempting it once. Keep the tests' exit code instead of the cleanup
# status.
cleanup() {
  local exitCode=$?
  [[ -n "$WEB_PROCESS_ID"    ]] && kill "$WEB_PROCESS_ID"    2>/dev/null || true
  [[ -n "$CHROME_PROCESS_ID" ]] && kill "$CHROME_PROCESS_ID" 2>/dev/null || true
  wait "$WEB_PROCESS_ID" "$CHROME_PROCESS_ID" 2>/dev/null || true
  for _ in $(seq 30); do rm -rf "$TEMP_DIRECTORY" 2>/dev/null && break; sleep 0.1; done
  [[ -d "$TEMP_DIRECTORY" ]] && echo "test.sh: could not remove $TEMP_DIRECTORY" >&2
  exit "$exitCode"
}
trap cleanup EXIT

"$PYTHON" -m http.server "$WEB_PORT" --bind 127.0.0.1 --directory "$ROOT" \
  >"$TEMP_DIRECTORY/web.log" 2>&1 &
WEB_PROCESS_ID=$!

# `--accept-lang` matters: without it, headless Chrome reports en-US and the
# app starts in feet and inches. The suites assume centimetres, so the test
# browser uses the language in which they were written. Language detection
# is tested in `units.js` by overriding `navigator.language`.
"$CHROME" --headless=new --remote-debugging-port="$CDP_PORT" \
          --no-first-run --no-default-browser-check --accept-lang=es-ES \
          --user-data-dir="$TEMP_DIRECTORY/chrome" about:blank >"$TEMP_DIRECTORY/chrome.log" 2>&1 &
CHROME_PROCESS_ID=$!

waitForServer() {
  for _ in $(seq 100); do "$CURL" -sf "$1" >/dev/null && return 0; sleep 0.1; done
  echo "test.sh: server did not start at $1" >&2
  return 1
}
waitForServer "http://127.0.0.1:$WEB_PORT/index.html"
waitForServer "http://127.0.0.1:$CDP_PORT/json/version"

export APP_URL="http://127.0.0.1:$WEB_PORT/"
export CDP_PORT

failures=0
for suite in wall-faces measure-chip wall-lock openings storage pdf parts-list theme units catalog problems copies shared; do
  echo "== $suite =="
  "$NODE" "$ROOT/tests/$suite.js" || failures=$((failures+1))
  echo
done

if (( failures )); then
  echo "$failures suite(s) failing"
  exit 1
fi
echo "all green"
