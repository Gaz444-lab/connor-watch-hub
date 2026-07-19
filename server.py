#!/usr/bin/env python3
"""
Watch Hub local server — static files + durable user-state API.
Binds 127.0.0.1 only. Library is written to data/user-state.json on disk
so Seen/Queue survive browser restarts (not only localStorage).
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8766
STATE_FILE = ROOT / "data" / "user-state.json"
MAX_BODY = 8 * 1024 * 1024  # 8 MB


def log(msg: str) -> None:
    print(msg, flush=True)


def read_state_file() -> dict[str, Any] | None:
    if not STATE_FILE.is_file():
        return None
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError) as e:
        log(f"[watch-hub] read state failed: {e}")
        return None


def write_state_file(payload: dict[str, Any]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    # Atomic write so a crash mid-save doesn't corrupt the file
    fd, tmp_name = tempfile.mkstemp(
        prefix="user-state-",
        suffix=".json",
        dir=str(STATE_FILE.parent),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp_name, STATE_FILE)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


class WatchHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args: Any) -> None:
        # Quieter access log
        if str(args[0]).startswith("GET /api/") or str(args[0]).startswith("POST /api/"):
            log(f"[watch-hub] {self.address_string()} {fmt % args}")

    def _json(self, code: int, payload: Any) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return b""
        if length > MAX_BODY:
            return b""
        return self.rfile.read(length)

    def do_GET(self) -> None:  # noqa: N802
        path = unquote(urlparse(self.path).path)
        if path == "/api/health":
            self._json(200, {"ok": True, "service": "connor-watch-hub"})
            return
        if path == "/api/state":
            data = read_state_file()
            if data is None:
                self._json(200, {"ok": True, "state": None, "disk": False})
            else:
                self._json(200, {"ok": True, "state": data, "disk": True})
            return
        if path.startswith("/api/"):
            self._json(404, {"ok": False, "error": "Unknown API route"})
            return
        return super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        path = unquote(urlparse(self.path).path)
        if path != "/api/state":
            if path.startswith("/api/"):
                self._json(404, {"ok": False, "error": "Unknown API route"})
            else:
                self.send_error(405, "Method not allowed")
            return

        raw = self._read_body()
        if not raw:
            self._json(400, {"ok": False, "error": "Empty body"})
            return
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "Invalid JSON"})
            return

        # Accept either { state: {...} } or bare state object
        if isinstance(payload, dict) and isinstance(payload.get("state"), dict):
            state_obj = payload["state"]
        elif isinstance(payload, dict) and "library" in payload:
            state_obj = payload
        else:
            self._json(400, {"ok": False, "error": "Expected state object with library"})
            return

        if not isinstance(state_obj.get("library"), dict):
            self._json(400, {"ok": False, "error": "state.library must be an object"})
            return

        try:
            write_state_file(state_obj)
            lib_n = len(state_obj.get("library") or {})
            seen_n = sum(
                1
                for e in (state_obj.get("library") or {}).values()
                if isinstance(e, dict) and e.get("status") == "seen"
            )
            self._json(
                200,
                {
                    "ok": True,
                    "disk": True,
                    "path": str(STATE_FILE.name),
                    "libraryCount": lib_n,
                    "seenCount": seen_n,
                },
            )
        except Exception as e:  # noqa: BLE001
            log(traceback.format_exc())
            self._json(500, {"ok": False, "error": str(e)})


def main() -> int:
    os.chdir(ROOT)
    (ROOT / "data").mkdir(parents=True, exist_ok=True)
    httpd = ThreadingHTTPServer((HOST, PORT), WatchHandler)
    log(f"Watch Hub → http://{HOST}:{PORT}/  (PID {os.getpid()})")
    log(f"User state → {STATE_FILE}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log("\nWatch Hub stopped.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
