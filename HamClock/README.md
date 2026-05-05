# HamClock Install Location

This directory is the install/deploy location you requested:

- n7six.github.io/HamClock

## What is here

- install-hamclock.sh: builds HamClock from /workspaces/HamClock and installs binary into ./bin/hamclock
- run-hamclock.sh: runs installed binary with web API on port 8080
- site/index.html: GitHub Pages frontend that displays live screenshot and status

## Install steps

1. cd /workspaces/n7six.github.io/HamClock
2. chmod +x install-hamclock.sh run-hamclock.sh
3. ./install-hamclock.sh
4. ./run-hamclock.sh

## Publish steps for GitHub Pages

1. Copy site/index.html into your pages repo path HamClock/index.html
2. Change API_BASE in index.html to your HTTPS reverse proxy URL
3. Ensure reverse proxy forwards to your running HamClock host on port 8080

## Notes

GitHub Pages only hosts static files. HamClock itself runs as a native process on Linux/RPi/macOS.
