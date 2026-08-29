#!/bin/sh
set -e
: "${API_BASE_URL:?API_BASE_URL must be set}"
printf 'window.APP_CONFIG = { apiBaseUrl: "%s" };\n' "$API_BASE_URL" > /usr/share/nginx/html/config.js
echo "storefront -> $API_BASE_URL"
exec nginx -g 'daemon off;'
