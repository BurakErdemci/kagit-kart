"""Static dev server that serves index.html inside the same skeleton the publishing host adds.

Usage: python tools/serve.py [port]
"""
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Must stay byte-identical in meaning to the host wrapper described in ARCHITECTURE.md §2.
HEAD = (
    '<!doctype html><html><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);'
    'padding-bottom:env(safe-area-inset-bottom)}'
    'body{margin:0;font:14px system-ui;background:#fafaf7}'
    'img{max-width:100%}[hidden]{display:none!important}</style>'
    '</head><body>'
)
TAIL = '</body></html>'

MIME = {
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.md': 'text/plain; charset=utf-8',
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        return MIME.get(ext) or super().guess_type(path)

    def do_GET(self):
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        if path in ('/', '/index.html'):
            with open(os.path.join(ROOT, 'index.html'), 'r', encoding='utf-8') as f:
                body = (HEAD + f.read() + TAIL).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    with Server(('127.0.0.1', port), Handler) as httpd:
        print(f'serving {ROOT} on http://127.0.0.1:{port}', flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
