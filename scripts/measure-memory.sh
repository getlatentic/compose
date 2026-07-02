#!/bin/bash
# Sample the packaged app's true memory footprint: the compose process PLUS its
# WKWebView helpers (WebContent / GPU / Networking), which is where most of a
# Tauri app's memory actually lives. Prints one CSV line per invocation:
#
#   <label>,main=..MB,webcontent=..MB,gpu=..MB,net=..MB,total=..MB
#
# Usage: scripts/measure-memory.sh [label]
# Run it before/after a scenario (tab churn, fs churn, idle soak) and diff the
# totals. Helpers are matched by launch time (same second as the app), which
# holds because WKWebView spawns them immediately at startup.
set -euo pipefail

LABEL="${1:-sample}"
MAIN=$(pgrep -x compose | head -1)
[ -n "$MAIN" ] || { echo "no running compose process" >&2; exit 1; }

fp() {
  footprint "$1" 2>/dev/null | awk '/phys_footprint:/ {
    v=$2; u=$3;
    if (u=="KB") v/=1024; else if (u=="GB") v*=1024;
    printf "%.0f", v; exit
  }'
}

MAIN_START=$(ps -o lstart= -p "$MAIN")
WC=0; GPU=0; NET=0
for h in $(ps -axo pid,comm | awk '/WebKit\.(WebContent|GPU|Networking)/ {print $1}'); do
  [ "$(ps -o lstart= -p "$h" 2>/dev/null)" = "$MAIN_START" ] || continue
  case "$(ps -o comm= -p "$h")" in
    *WebContent*) WC=$(fp "$h");;
    *GPU*) GPU=$(fp "$h");;
    *Networking*) NET=$(fp "$h");;
  esac
done
M=$(fp "$MAIN")
M=${M:-0}; WC=${WC:-0}; GPU=${GPU:-0}; NET=${NET:-0}
echo "$LABEL,main=${M}MB,webcontent=${WC}MB,gpu=${GPU}MB,net=${NET}MB,total=$((M + WC + GPU + NET))MB"
