#!/bin/sh
# Deploys Labbai on the production server (46.8.195.221, /home/ubuntu/labbai):
# pull GHCR images, run migrations, restart. Other projects on the box are untouched.
set -e
cd /home/ubuntu/labbai
C="docker compose -f docker-compose.prod.yml"
$C --profile setup pull 2>&1 | tail -2
$C up -d db redis uploads-init 2>&1 | tail -2
$C --profile setup run --rm migrations 2>&1 | grep -vE 'NOTICE|severity|already exists|^\s*(code|file|line|routine|where|schema|table|detail|hint|position|internalPosition|internalQuery|constraint|dataType|column|length|name):|^\s*[{}]' | tail -4
$C up -d --remove-orphans 2>&1 | tail -4
for i in $(seq 1 60); do c=$(docker run --rm --network edge curlimages/curl:latest -s -o /dev/null -w '%{http_code}' http://labbai-app:3000/login); [ "$c" = "200" ] && break; sleep 3; done
echo "app=$c"
$C ps --format "{{.Service}} {{.State}} {{.Status}}"
