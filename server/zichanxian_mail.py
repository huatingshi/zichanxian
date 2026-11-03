#!/usr/bin/env python3
"""资产线 · 邮箱同步服务

Logs into a dedicated bill mailbox over IMAP (read-only), finds bill attachments
(.zip / .xlsx / .xls / .csv / .pdf) and hands the raw files to the 资产线 web page.
It never unzips, parses or stores bills; parsing stays on the phone.

Configuration comes from environment variables (see install.sh, /etc/zichanxian-mail.env):
  IMAP_HOST, IMAP_PORT (993), IMAP_USER, IMAP_PASS (mailbox authorization code),
  ACCESS_TOKEN (what the phone sends), ALLOW_ORIGIN (comma-separated, e.g. https://huatingshi.github.io),
  LISTEN (127.0.0.1:8787), DAYS (how far back to look, default 120), MAX_MESSAGES (default 200),
  IMAP_FOLDER (default INBOX; e.g. a "账单" folder fed by a mail rule), FROM_FILTER (optional,
  comma-separated sender substrings; only those senders' mail is read).
Only the Python standard library is used.

  python3 zichanxian_mail.py          run the service
  python3 zichanxian_mail.py --check  log in once, list folders and the bill attachments found, then exit
"""
import datetime
import email
import email.policy
import email.utils
import email.message
import urllib.error
import hashlib
import hmac
import imaplib
import json
import html
import urllib.request
import base64
import re
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
        self.folder = os.environ.get("IMAP_FOLDER", "").strip() or "INBOX"
        self.from_filter = [f.strip().lower() for f in os.environ.get("FROM_FILTER", "").split(",") if f.strip()]
        if len(self.token) < 24:
            sys.exit("ACCESS_TOKEN is too short; use at least 24 random characters")


def utf7_encode(s: str) -> str:
    """IMAP modified UTF-7 (RFC 3501) for folder names such as 其他文件夹/账单."""
    out, buf = [], []
    def flush():
        if buf:
            b = "".join(buf).encode("utf-16-be")
            out.append("&" + base64.b64encode(b).decode().rstrip("=").replace("/", ",") + "-")
            buf.clear()
    for ch in s:
        if 0x20 <= ord(ch) <= 0x7E:
            flush()
            out.append("&-" if ch == "&" else ch)
        else:
            buf.append(ch)
    flush()
    return "".join(out)


def utf7_decode(s: str) -> str:
    res, i = [], 0
    while i < len(s):
        if s[i] == "&":
            j = s.index("-", i)
            if j == i + 1:
                res.append("&")
            else:
                b64 = s[i + 1:j].replace(",", "/")
                res.append(base64.b64decode(b64 + "=" * (-len(b64) % 4)).decode("utf-16-be"))
            i = j + 1
        else:
            res.append(s[i])
            i += 1
    return "".join(res)


def quote_mailbox(name: str) -> str:
    enc = utf7_encode(name)
    return '"' + enc.replace("\\", "\\\\").replace('"', '\\"') + '"'


LIST_RE = re.compile(r'\((?P<flags>[^)]*)\) (?P<delim>"[^"]*"|NIL) (?P<name>.+)$')


def list_folders(m):
    typ, data = m.list()
    names = []
    for line in data or []:
        if not isinstance(line, bytes):
            continue
        mt = LIST_RE.match(line.decode("utf-8", "replace"))
        if mt:
            name = mt.group("name").strip()
            if name.startswith('"') and name.endswith('"'):
                name = name[1:-1].replace('\\"', '"')
            names.append(utf7_decode(name))
    return names


# Some bills (e.g. 微信支付) arrive as a download link instead of an attachment. Only links on these
# sites are followed, so the server never fetches arbitrary URLs found in mail.
LINK_HOSTS = ("tenpay.com", "wechatpay.cn", "weixin.qq.com", "wx.qq.com", "qq.com", "alipay.com",
              "alipayobjects.com", "boc.cn", "bankofchina.com")
HREF_RE = re.compile(r"""href\s*=\s*["']([^"']+)["']""", re.I)
URL_RE = re.compile(r"""https://[^\s"'<>()]+""")
MAX_DOWNLOAD = 25 * 1024 * 1024


def host_allowed(url):
    host = (urlparse(url).hostname or "").lower()
    return url.startswith("https://") and any(host == h or host.endswith("." + h) for h in LINK_HOSTS)


def body_links(msg):
    urls = []
    for part in msg.walk():
        if part.get_content_type() not in ("text/html", "text/plain"):
            continue
        try:
            text = part.get_content()
        except Exception:
            continue
        for u in HREF_RE.findall(text) + URL_RE.findall(text):
            u = html.unescape(u).strip()
            if host_allowed(u) and u not in urls:
                urls.append(u)
    urls.sort(key=lambda u: 0 if re.search(r"down|file|bill|attach|export", u, re.I) else 1)
    return urls[:6]


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not host_allowed(newurl):
            raise urllib.error.URLError("跳转到了不在白名单里的网站：" + (urlparse(newurl).hostname or ""))
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = urllib.request.build_opener(SafeRedirect, urllib.request.HTTPSHandler(context=ssl.create_default_context()))


def sniff_ext(data: bytes):
    if data[:4] == b"%PDF":
        return ".pdf"
    if data[:2] == b"PK":
        return ".zip"
    if data[:4] == b"\xd0\xcf\x11\xe0":
        return ".xls"
    return None


def download_link(url, fallback_name):
    """Fetch a bill file from an allow-listed link. Returns (name, bytes) or raises with a reason."""
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
        "Accept": "*/*"})
    with _opener.open(req, timeout=40) as r:
        data = r.read(MAX_DOWNLOAD + 1)
        if len(data) > MAX_DOWNLOAD:
            raise ValueError("文件太大")
        ext = sniff_ext(data)
        if not ext:
            raise ValueError("链接打开的是网页而不是文件（可能需要在微信里打开，或链接已过期）")
        name = ""
        cd = r.headers.get("Content-Disposition", "")
        if cd:
            hm = email.message.Message(); hm["content-disposition"] = cd
            name = hm.get_filename() or ""
            try:
                name = name.encode("latin-1").decode("utf-8")
            except (UnicodeEncodeError, UnicodeDecodeError):
                pass
        if not name.lower().endswith(EXTS):
            name = (name.rsplit(".", 1)[0] if name else fallback_name) + ext
        return name, data


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
        self.skipped = []         # bill mails whose file could not be fetched, with the reason

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
                typ, _ = m.select(quote_mailbox(self.cfg.folder), readonly=True)
                if typ != "OK":
                    raise RuntimeError("无法打开文件夹 " + self.cfg.folder)
                uidvalidity = (m.response("UIDVALIDITY")[1] or [b"0"])[0]
                since = (datetime.date.today() - datetime.timedelta(days=self.cfg.days)).strftime("%d-%b-%Y")
                typ, data = m.uid("SEARCH", None, "SINCE", since)
                uids = (data[0] or b"").split()[-self.cfg.max_messages:]
                listing, skipped = [], []
                for uid in reversed(uids):
                    key = (uidvalidity, uid)
                    if key not in self.by_uid:
                        typ, md = m.uid("FETCH", uid, "(BODY.PEEK[])")
                        raw = next((p[1] for p in md if isinstance(p, tuple)), b"")
                        msg, atts = extract_attachments(raw)
                        meta = message_meta(msg)
                        if self.cfg.from_filter and not any(f in meta["from"].lower() for f in self.cfg.from_filter):
                            self.by_uid[key] = []
                            continue
                        failed = None
                        if not atts:
                            links = body_links(msg)
                            reasons = []
                            for u in links:
                                try:
                                    atts.append(download_link(u, re.sub(r"[\\/:*?\"<>|]", "_", meta["subject"])[:60] or "账单"))
                                    break
                                except Exception as e:  # noqa: BLE001 - report the reason to the page
                                    reasons.append(f"{urlparse(u).hostname}{urlparse(u).path[:40]}：{e}")
                            if links and not atts:
                                failed = dict(meta, reason="邮件里是下载链接，服务器没能下载。" + "；".join(reasons[:2]))
                        items = []
                        for name, payload in atts:
                            item = dict(meta, id=hashlib.sha256(payload).hexdigest()[:24], name=name, size=len(payload), data=payload)
                            items.append(item)
                        if failed:
                            skipped.append(failed)   # not cached: try again next time
                            continue
                        self.by_uid[key] = items
                    for item in self.by_uid[key]:
                        self.items[item["id"]] = item
                        listing.append({k: v for k, v in item.items() if k != "data"})
            finally:
                try:
                    m.logout()
                except Exception:
                    pass
            self.listing, self.skipped, self.listed_at = listing, skipped, time.time()
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
                    items = box.refresh()
                    return self.reply(200, {"mailbox": cfg.user, "days": cfg.days, "items": items, "skipped": box.skipped})
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


def check(cfg: Config):
    box = Mailbox(cfg)
    m = box._connect()
    print("登录成功：", cfg.user)
    print("服务器上的文件夹：")
    for name in list_folders(m):
        print("  -", name)
    m.logout()
    print(f"\n正在读取「{cfg.folder}」最近 {cfg.days} 天的邮件" + (f"（只看发件人包含 {', '.join(cfg.from_filter)} 的）" if cfg.from_filter else "") + " …")
    items = box.refresh(force=True)
    for it in items:
        when = datetime.datetime.fromtimestamp(it["date"] / 1000).strftime("%Y-%m-%d %H:%M") if it["date"] else "?"
        print(f"  {when}  {it['name']}  ({it['size']} 字节)  {it['subject'][:40]}")
    print(f"共找到 {len(items)} 个账单文件。")
    for sk in box.skipped:
        print(f"  没取到：{sk['subject'][:40]} —— {sk['reason']}")


def main():
    cfg = Config()
    if "--check" in sys.argv:
        try:
            check(cfg)
        except imaplib.IMAP4.error as e:
            sys.exit("邮箱登录或读取失败：" + str(e) + "\n（检查邮箱地址、授权码，以及 IMAP_FOLDER 是否是上面列出的文件夹名）")
        except (OSError, RuntimeError) as e:
            sys.exit("连不上邮箱服务器：" + str(e))
        return
    box, guard = Mailbox(cfg), Guard()
    httpd = ThreadingHTTPServer(cfg.listen, make_handler(cfg, box, guard))
    sys.stderr.write(f"zichanxian-mail listening on {cfg.listen[0]}:{cfg.listen[1]} for {cfg.user}\n")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
