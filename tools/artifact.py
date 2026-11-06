"""Turns dist/index.html into the page body the artifact host expects: no doctype, html, head or body."""
import re
html = open('dist/index.html', encoding='utf-8').read()
styles = re.findall(r'<style[^>]*>.*?</style>', html, re.S)
scripts = re.findall(r'<script[^>]*>.*?</script>', html, re.S)
page = ('<title>Collective Face</title>\n'
        '<meta name="claude:viewport-fit-sides" content="cover">\n'
        + '\n'.join(styles) + '\n<div id="root"></div>\n' + '\n'.join(scripts) + '\n')
open('dist/artifact.html', 'w', encoding='utf-8').write(page)
print(len(page) // 1024, 'KB', len(scripts), 'scripts', len(styles), 'styles')
