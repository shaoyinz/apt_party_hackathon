#!/bin/sh
set -eu
node scripts/migrate.mjs
exec node server/production.mjs
