#!/bin/bash
# usage: tools/cs.sh out.png mother [names] [angle]
out=$1; shift
npx esbuild tools/contact.ts --bundle --platform=node --format=cjs --outfile=/tmp/claude-0/cs.cjs --log-level=error --external:node:fs
OUT=/tmp/claude-0/cs.pgm node /tmp/claude-0/cs.cjs "$@" && python3 -c "from PIL import Image; Image.open('/tmp/claude-0/cs.pgm').save('$out')"
