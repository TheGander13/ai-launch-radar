"""Local dev server: serves static files + same-origin proxy to FreeSerp.
Needed because freeserp.ai sends a duplicated Access-Control-Allow-Origin header,
which browsers reject. Mirrors the rewrites in vercel.json."""
import http.server, urllib.request, urllib.error, urllib.parse

UPSTREAM = "https://freeserp.ai/api.php"
ROUTES = {"/api/freeserp": "", "/api/overview": "stats=1"}

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path in ROUTES:
            qs = "&".join(x for x in (ROUTES[path], query) if x)
            url = f"{UPSTREAM}?{qs}"
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "AILaunchRadar/1.0 (dev proxy)"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    status, body = r.status, r.read()
            except urllib.error.HTTPError as e:
                status, body = e.code, e.read()
            except Exception as e:
                status, body = 502, f'{{"ok":false,"error":"proxy","detail":"{type(e).__name__}"}}'.encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

if __name__ == "__main__":
    print("Dev server: http://localhost:8080")
    http.server.ThreadingHTTPServer(("", 8080), Handler).serve_forever()
