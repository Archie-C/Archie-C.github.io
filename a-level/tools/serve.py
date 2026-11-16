"""Serve this checkout locally with deterministic browser asset MIME types."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class RevisionHandler(SimpleHTTPRequestHandler):
    # Windows registry associations can override Python's default MIME guesses.
    # Explicit handler mappings take precedence over those system associations.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".wasm": "application/wasm",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def create_server(port=8000):
    handler = partial(RevisionHandler, directory=str(REPOSITORY_ROOT))
    return ThreadingHTTPServer(("127.0.0.1", port), handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    try:
        server = create_server(args.port)
    except OSError as error:
        parser.exit(1, f"Could not start local server: {error}\nStop the existing server or choose --port 8001.\n")
    with server:
        address = f"http://127.0.0.1:{server.server_port}"
        print(f"Student revision: {address}/a-level/", flush=True)
        print(f"Admin dashboard:  {address}/admin/", flush=True)
        print("Press Ctrl+C to stop.", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
