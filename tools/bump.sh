#!/bin/sh
# Run before each commit so browsers load the newest style.css, app.js and config.js.
V=$(date +%s)
sed -i "s#style.css?v=[0-9]*#style.css?v=$V#; s#app.js?v=[0-9]*#app.js?v=$V#; s#config.js?v=[0-9]*#config.js?v=$V#" "$(dirname "$0")/../index.html"
