#!/bin/bash
# usage: tools/pv.sh out.png 0 0.33 1
out=$1; shift
npx esbuild tools/preview.ts --bundle --platform=node --format=cjs --outfile=/tmp/claude-0/pv.cjs --log-level=error --external:node:fs
OUT=/tmp/claude-0/pv.pgm node /tmp/claude-0/pv.cjs "$@" && python3 -c "from PIL import Image; Image.open('/tmp/claude-0/pv.pgm').save('$out')"
