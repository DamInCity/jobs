#!/bin/bash
# Hermes cron wrapper — .js files would otherwise be executed as Python.
set -euo pipefail
exec /usr/bin/node /var/www/jobs/scripts/refreshOpenRouterFreeModels.js "$@"
