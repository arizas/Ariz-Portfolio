#!/bin/bash

yarn

# Chromium only. playwright.config.js has firefox and webkit commented out, so
# a bare `playwright install` spends most of its time and about 1.3 GB fetching
# browsers no test runs — a long wait on a first container build, for nothing.
yarn playwright install-deps chromium
yarn playwright install chromium

# The desktop-lite feature serves noVNC on 6080; .devcontainer/start-chromium.sh
# launches Playwright's Chromium onto it with remote debugging open, so the app
# can be exercised in a real browser and driven from inside the container.
echo
echo "Desktop:  http://localhost:6080  (password: vscode)"
echo "Browser:  ./.devcontainer/start-chromium.sh"
echo "App:      yarn serve   ->  http://localhost:8081"

curl --proto '=https' --tlsv1.2 -LsSf https://github.com/mpeterdev/bos-loader/releases/download/v0.11.0/bos-loader-v0.11.0-installer.sh | sh
