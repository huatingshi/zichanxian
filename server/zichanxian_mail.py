#!/usr/bin/env python3
"""资产线 · 邮箱同步服务

Logs into a dedicated bill mailbox over IMAP (read-only), finds bill attachments
(.zip / .xlsx / .xls / .csv / .pdf) and hands the raw files to the 资产线 web page.
It never unzips, parses or stores bills; parsing stays on the phone.

Configuration comes from environment variables (see install.sh, /etc/zichanxian-mail.env):
  IMAP_HOST, IMAP_PORT (993), IMAP_USER, IMAP_PASS (mailbox authorization code),
  ACCESS_TOKEN (what the phone sends), ALLOW_ORIGIN (comma-separated, e.g. https://huatingshi.github.io),
  LISTEN (127.0.0.1:8787), DAYS (how far back to look, default 120), MAX_MESSAGES (default 200).
Only the Python standard library is used.
"""
import datetime
import email
import email.policy
import email.utils
import hashlib
import hmac
import imaplib
import json
import os
import ssl
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, urlparse

EXTS = (".zip", ".xlsx", ".xls", ".csv", ".pdf")
NETEASE = ("163.com", "126.com", "yeah.net")
imaplib.Commands.setdefault("ID", ("NONAUTH", "AUTH", "SELECTED"))


def env(name, default=None):
    v = os.environ.get(name, default)
    if v is None or v == "":
        sys.exit(f"missing setting {name}")
    return v


class Config:
    def __init__(self):
        self.host = env("IMAP_HOST")
        self.port = int(env("IMAP_PORT", "993"))
        self.user = env("IMAP_USER")
        self.password = env("IMAP_PASS")
        self.token = env("ACCESS_TOKEN")
        self.origins = [o.strip().rstrip("/") for o in env("ALLOW_ORIGIN", "https://huatingshi.github.io").split(",") if o.strip()]
        listen = env("LISTEN", "127.0.0.1:8787")
        h, _, p = listen.rpartition(":")
        self.listen = (h or "127.0.0.1", int(p))
        self.days = int(env("DAYS", "120"))
        self.max_messages = int(env("MAX_MESSAGES", "200"))
        if len(self.token) < 24:
            sys.exit("ACCESS_TOKEN is too short; use at least 24 random characters")


def extract_attachments(raw: bytes):
    """Return [(filename, payload_bytes)] for bill-like attachments in one raw message."""
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    out = []
    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        name = part.get_filename() or ""
        if not name.lower().endswith(EXTS):
            continue
        payload = part.get_payload(decode=True) or b""
        if payload:
            out.append((name, payload))
    return msg, out


def message_meta(msg):
    try:
        dt = email.utils.parsedate_to_datetime(msg["Date"]) if msg["Date"] else None
        ts = int(dt.timestamp() * 1000) if dt else 0
    except (TypeError, ValueError):
        ts = 0
    return {"from": str(msg.get("From", "")), "subject": str(msg.get("Subject", "")), "date": ts}


class Mailbox:
    """Fetches attachments; caches parsed messages by UID and the whole listing for a short time."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.lock = threading.Lock()
        self.by_uid = {}          # (uidvalidity, uid) -> [items]
        self.items = {}           # id -> item (with data)
        self.listed_at = 0.0
        self.listing = []

    def _connect(self):
        ctx = ssl.create_default_context()
        m = imaplib.IMAP4_SSL(self.cfg.host, self.cfg.port, ssl_context=ctx, timeout=30)
        if self.cfg.host.endswith(NETEASE):
            # NetEase mailboxes refuse IMAP clients that do not identify themselves.
            m._simple_command("ID", '("name" "zichanxian" "version" "1.0" "vendor" "zichanxian")')
        m.login(self.cfg.user, self.cfg.password)
        return m

    def refresh(self, force=False):
        with self.lock:
            if not force and time.time() - self.listed_at < 90:
                return self.listing
            m = self._connect()
            try:
                typ, _ = m.select("INBOX", readonly=True)
                if typ != "OK":
                    raise RuntimeError("无法打开收件箱")
                uidvalidity = (m.response("UIDVALIDITY")[1] or [b"0"])[0]
                since = (datetime.date.today() - datetime.timedelta(days=self.cfg.days)).strftime("%d-%b-%Y")
                typ, data = m.uid("SEARCH", None, "SINCE", since)
                uids = (data[0] or b"").split()[-self.cfg.max_messages:]
                listing = []
                for uid in reversed(uids):
                    key = (uidvalidity, uid)
                    if key not in self.by_uid:
                        typ, md = m.uid("FETCH", uid, "(BODY.PEEK[])")
                        raw = next((p[1] for p in md if isinstance(p, tuple)), b"")
                        msg, atts = extract_attachments(raw)
                        meta = message_meta(msg)
                        items = []
                        for name, payload in atts:
                            item = dict(meta, id=hashlib.sha256(payload).hexdigest()[:24], name=name, size=len(payload), data=payload)
                            items.append(item)
                        self.by_uid[key] = items
                    for item in self.by_uid[key]:
                        self.items[item["id"]] = item
                        listing.append({k: v for k, v in item.items() if k != "data"})
            finally:
                try:
                    m.logout()
                except Exception:
                    pass
            self.listing, self.listed_at = listing, time.time()
            return listing

    def get(self, aid):
        if aid not in self.items:
            self.refresh(force=True)
        return self.items.get(aid)


class Guard:
    """Locks out an address after repeated wrong tokens."""

    def __init__(self, limit=10, window=900):
        self.limit, self.window, self.fails, self.lock = limit, window, {}, threading.Lock()

    def blocked(self, ip):
        with self.lock:
            hits = [t for t in self.fails.get(ip, []) if time.time() - t < self.window]
            self.fails[ip] = hits
            return len(hits) >= self.limit

    def fail(self, ip):
        with self.lock:
            self.fails.setdefault(ip, []).append(time.time())


def make_handler(cfg: Config, box: Mailbox, guard: Guard):
    class Handler(BaseHTTPRequestHandler):
        server_version = "zichanxian-mail/1.0"

        def log_message(self, fmt, *args):  # keep logs free of tokens and file names
            sys.stderr.write("%s - %s\n" % (self.client_ip(), fmt % args))

        def client_ip(self):
            ip = self.client_address[0]
            if ip in ("127.0.0.1", "::1"):
                fwd = self.headers.get("X-Forwarded-For", "")
                if fwd:
                    return fwd.split(",")[0].strip()
            return ip

        def cors(self):
            origin = (self.headers.get("Origin") or "").rstrip("/")
            if origin in cfg.origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Headers", "Authorization")
                self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
                self.send_header("Access-Control-Max-Age", "600")

        def reply(self, code, body=b"", ctype="application/json; charset=utf-8", extra=None):
            if isinstance(body, (dict, list)):
                body = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.cors()
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def do_OPTIONS(self):
            self.reply(204)

        def authorized(self):
            ip = self.client_ip()
            if guard.blocked(ip):
                self.reply(429, {"error": "口令错误次数太多，请 15 分钟后再试"})
                return False
            got = self.headers.get("Authorization", "")
            want = "Bearer " + cfg.token
            if not hmac.compare_digest(got.encode(), want.encode()):
                guard.fail(ip)
                self.reply(401, {"error": "访问口令不对"})
                return False
            return True

        def do_GET(self):
            path = urlparse(self.path).path.rstrip("/")
            if path == "/api/health":
                return self.reply(200, {"ok": True})
            if not path.startswith("/api/attachments"):
                return self.reply(404, {"error": "not found"})
            if not self.authorized():
                return
            try:
                if path == "/api/attachments":
                    return self.reply(200, {"mailbox": cfg.user, "days": cfg.days, "items": box.refresh()})
                aid = path.rsplit("/", 1)[-1]
                item = box.get(aid)
                if not item:
                    return self.reply(404, {"error": "附件不存在或已过期"})
                disp = "attachment; filename*=UTF-8''" + quote(item["name"])
                return self.reply(200, item["data"], "application/octet-stream", {"Content-Disposition": disp})
            except imaplib.IMAP4.error as e:
                return self.reply(502, {"error": "邮箱登录或读取失败：" + str(e)[:200]})
            except (OSError, RuntimeError) as e:
                return self.reply(502, {"error": "连不上邮箱服务器：" + str(e)[:200]})

    return Handler


def main():
    cfg = Config()
    box, guard = Mailbox(cfg), Guard()
    httpd = ThreadingHTTPServer(cfg.listen, make_handler(cfg, box, guard))
    sys.stderr.write(f"zichanxian-mail listening on {cfg.listen[0]}:{cfg.listen[1]} for {cfg.user}\n")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
