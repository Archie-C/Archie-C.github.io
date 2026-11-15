"""Regression check for module MIME types, including broken system mappings."""

import importlib.util
import mimetypes
from pathlib import Path
import threading
import unittest
from unittest.mock import patch
from urllib.request import urlopen


spec = importlib.util.spec_from_file_location("revision_server", Path(__file__).resolve().parents[1] / "tools" / "serve.py")
server_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server_module)


class LocalServerTests(unittest.TestCase):
    def test_browser_assets_override_system_mime_types(self):
        mimetypes.init()
        with patch.dict(mimetypes.types_map, {".mjs": "text/plain", ".js": "text/plain"}):
            with server_module.create_server(0) as server:
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    base = f"http://127.0.0.1:{server.server_port}"
                    modules = ["app.mjs", "api.mjs", "model.mjs", "timezones.mjs", "options.mjs", "admin.mjs", "admin-import.mjs", "config.js", "assets/vendor/supabase.js"]
                    for filename in modules:
                        with self.subTest(filename=filename), urlopen(f"{base}/a-level/{filename}", timeout=5) as response:
                            self.assertEqual(response.status, 200)
                            self.assertEqual(response.headers.get_content_type(), "text/javascript")
                            self.assertEqual(response.headers["Cache-Control"], "no-store")
                            self.assertTrue(response.read())
                    for path in ["/a-level/", "/admin/"]:
                        with urlopen(base + path, timeout=5) as response:
                            self.assertEqual(response.headers.get_content_type(), "text/html")
                finally:
                    server.shutdown()
                    thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
