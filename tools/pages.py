"""Build the GitHub Pages site into _site/: index.html wrapped in the host skeleton, plus src/.

index.html is a page body (the original publishing host adds the skeleton), so Pages needs the
same wrapper serve.py applies locally; the wrapper is imported from there to keep one copy.

Usage: python tools/pages.py [out_dir]
"""
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from serve import HEAD, ROOT, TAIL  # noqa: E402


def main(out='_site'):
    out = os.path.join(ROOT, out)
    shutil.rmtree(out, ignore_errors=True)
    shutil.copytree(os.path.join(ROOT, 'src'), os.path.join(out, 'src'))
    with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as f:
        body = f.read()
    with open(os.path.join(out, 'index.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(HEAD + body + TAIL)
    # Jekyll would drop src/track/defs/_path.js (leading underscore).
    open(os.path.join(out, '.nojekyll'), 'w').close()


if __name__ == '__main__':
    main(*sys.argv[1:])
