#!/bin/bash

yarn
yarn playwright install-deps
yarn playwright install
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/mpeterdev/bos-loader/releases/download/v0.11.0/bos-loader-v0.11.0-installer.sh | sh
