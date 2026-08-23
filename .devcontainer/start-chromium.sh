#!/bin/bash
# Chromium on the container's desktop, with remote debugging open.
#
# Uses the Chromium that `yarn playwright install` already put in the image
# rather than pulling one from apt: Ubuntu's chromium is a snap, which does not
# work in a container, and there is no reason to carry two browsers.
#
# Watch it at http://localhost:6080 (password: vscode). Attach to it with
# Playwright's connectOverCDP('http://127.0.0.1:9222') from inside the
# container — the port is not published to the host, so nothing outside can
# drive it.
set -euo pipefail

PROFILE="${CHROMIUM_PROFILE:-$HOME/.chromium-dev}"
PORT="${CHROMIUM_DEBUG_PORT:-9222}"
URL="${1:-http://localhost:8081/portfolio}"

# Look in every plausible cache, not just this user's: postCreate runs as the
# container user while `docker exec` lands as root, so the same script can be
# invoked from either side and must find the one install that exists.
find_chromium() {
    for root in "$HOME/.cache/ms-playwright" /home/*/.cache/ms-playwright /root/.cache/ms-playwright \
                "${PLAYWRIGHT_BROWSERS_PATH:-/nonexistent}"; do
        ls -d "$root"/chromium-*/chrome-linux/chrome 2>/dev/null | sort -V | tail -1 && return 0
    done
    return 1
}

BIN=$(find_chromium || true)
if [ -z "$BIN" ]; then
    # Distinguish "not installed" from "installing right now" — the download is
    # several hundred megabytes and the difference matters to whoever is waiting.
    if pgrep -f "playwright install" >/dev/null 2>&1; then
        echo "Playwright is still downloading browsers. Wait for postCreate to finish, then run this again." >&2
    else
        echo "No Playwright Chromium found. Run: yarn playwright install chromium" >&2
    fi
    exit 1
fi

if curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    echo "Chromium is already listening on $PORT"
    exit 0
fi

mkdir -p "$PROFILE"
# --no-sandbox: Chromium's sandbox needs user namespaces the container does not
# grant. The container is the boundary here, and this browser only ever visits
# localhost.
DISPLAY="${DISPLAY:-:1}" nohup "$BIN" \
    --remote-debugging-port="$PORT" \
    --user-data-dir="$PROFILE" \
    --no-sandbox \
    --no-first-run \
    --disable-features=Translate \
    "$URL" > /tmp/chromium.log 2>&1 &

for _ in $(seq 1 30); do
    if curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
        echo "Chromium up on :$PORT — desktop at http://localhost:6080"
        exit 0
    fi
    sleep 1
done
echo "Chromium did not open the debug port; see /tmp/chromium.log" >&2
exit 1
