#!/usr/bin/env bash
# Deploy MS Social Pilot directly on the Server
exec bash "$(dirname "$0")/app/scripts/deploy-from-server.sh" "$@"
