"""Tests for server/zichanxian_mail.py with a fake IMAP mailbox. Run: python3 tests/test_server.py"""
import email.message, json, os, sys, threading, urllib.request, urllib.error
from http.server import ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "server"))
os.environ.update(IMAP_HOST="imap.qq.com", IMAP_USER="bills@qq.com", IMAP_PASS="x", ACCESS_TOKEN="t" * 32, ALLOW_ORIGIN="https://huatingshi.github.io", LISTEN="127.0.0.1:0")
import zichanxian_mail as zm

def make_msg(subject, files):
    m = email.message.EmailMessage(); m["From"] = "微信支付 <wechatpay@tencent.com>"; m["Subject"] = subject; m["Date"] = "Mon, 02 Nov 2026 10:00:00 +0800"
    m.set_content("账单见附件")
    for name, data in files: m.add_attachment(data, maintype="application", subtype="octet-stream", filename=name)
    return m.as_bytes()

FIX = os.path.join(ROOT, "tests", "fixtures")
WX = open(os.path.join(FIX, "wx.zip"), "rb").read(); BOC = open(os.path.join(FIX, "boc.pdf"), "rb").read()
MSGS = {b"1": make_msg("微信支付账单", [("微信支付账单(20261001-20261102).zip", WX)]), b"2": make_msg("中国银行交易流水", [("交易流水.pdf", BOC), ("logo.png", b"x")]), b"3": make_msg("广告", [])}

class FakeIMAP:
    logins = 0
    def select(self, box, readonly=False): assert readonly; return "OK", [b"3"]
    def response(self, code): return code, [b"42"]
    def uid(self, cmd, *a):
        if cmd == "SEARCH": return "OK", [b"1 2 3"]
        return "OK", [(b"x", MSGS[a[0]]), b")"]
    def logout(self): pass

def fake_connect(self): FakeIMAP.logins += 1; return FakeIMAP()
zm.Mailbox._connect = fake_connect

cfg = zm.Config(); box = zm.Mailbox(cfg); guard = zm.Guard(limit=3)
srv = ThreadingHTTPServer(("127.0.0.1", 0), zm.make_handler(cfg, box, guard)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{port}"
def req(path, token=None, method="GET", origin="https://huatingshi.github.io"):
    r = urllib.request.Request(base + path, method=method, headers={"Origin": origin, **({"Authorization": "Bearer " + token} if token else {})})
    try:
        with urllib.request.urlopen(r) as resp: return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e: return e.code, dict(e.headers), e.read()

ok = lambda c, m: print(("PASS " if c else "FAIL ") + m) or (c or sys.exit(1))
s, h, b = req("/api/health"); ok(s == 200 and json.loads(b)["ok"], "health")
s, h, b = req("/api/attachments", method="OPTIONS"); ok(s == 204 and h.get("Access-Control-Allow-Origin") == "https://huatingshi.github.io", "CORS preflight for the page")
s, h, b = req("/api/attachments", method="OPTIONS", origin="https://evil.example"); ok("Access-Control-Allow-Origin" not in h, "no CORS for other sites")
s, h, b = req("/api/attachments"); ok(s == 401, "no token -> 401")
s, h, b = req("/api/attachments", "t" * 32); items = json.loads(b)["items"]
ok(s == 200 and [i["name"] for i in items] == ["交易流水.pdf", "微信支付账单(20261001-20261102).zip"], "lists only bill attachments, newest first: %s" % [i["name"] for i in items])
ok(all("data" not in i for i in items) and items[0]["date"] > 0, "listing has no file bytes, has dates")
s, h, b = req("/api/attachments/" + items[1]["id"], "t" * 32); ok(s == 200 and b == WX and "filename*=UTF-8''" in h.get("Content-Disposition", ""), "download returns exact zip bytes")
req("/api/attachments", "t" * 32); ok(FakeIMAP.logins == 1, "listing cached (1 IMAP login)")
for _ in range(3): req("/api/attachments", "wrong")
s, h, b = req("/api/attachments", "t" * 32); ok(s == 429, "locked out after repeated wrong tokens")
# folder + sender filter
os.environ.update(IMAP_FOLDER="其他文件夹/账单", FROM_FILTER="alipay")
seen = {}
class FolderIMAP(FakeIMAP):
    def select(self, box, readonly=False): seen["box"] = box; return "OK", [b"3"]
zm.Mailbox._connect = lambda self: FolderIMAP()
cfg2 = zm.Config(); items2 = zm.Mailbox(cfg2).refresh()
ok(seen["box"] == '"&UXZO1mWHTvZZOQ-/&jSZTVQ-"', "Chinese folder name is sent in IMAP UTF-7: " + seen["box"])
ok(items2 == [], "FROM_FILTER skips mail from other senders")
os.environ["FROM_FILTER"] = "wechatpay"; items3 = zm.Mailbox(zm.Config()).refresh()
ok(len(items3) == 2, "FROM_FILTER keeps matching senders")
# bills that arrive as a download link (微信支付)
class FakeResp:
    def __init__(self, data, cd=""): self.data, self.headers = data, {"Content-Disposition": cd}
    def read(self, n): return self.data[:n]
    def __enter__(self): return self
    def __exit__(self, *a): pass
fetched = []
def fake_open(req, timeout=0):
    fetched.append(req.full_url)
    if "expired" in req.full_url: return FakeResp(b"<html>link expired</html>")
    return FakeResp(WX, "attachment; filename*=UTF-8''%E5%BE%AE%E4%BF%A1%E6%94%AF%E4%BB%98%E8%B4%A6%E5%8D%95.zip")
zm._opener.open = fake_open
def link_msg(subject, url):
    m = email.message.EmailMessage(); m["From"] = "微信支付 <wechatpay@tencent.com>"; m["Subject"] = subject; m["Date"] = "Tue, 03 Nov 2026 15:47:00 +0800"
    m.set_content("你好"); m.add_alternative(f'<p>请<a href="https://evil.example/steal">别点</a> <a href="{url}">点击下载</a></p>', subtype="html"); return m.as_bytes()
MSGS2 = {b"7": link_msg("微信支付-账单流水文件(20260803-20261103)", "https://tenpay.wechatpay.cn/userroll/download?token=abc&amp;x=1"),
         b"8": link_msg("微信支付-账单流水文件(旧)", "https://tenpay.wechatpay.cn/userroll/download?expired=1")}
class LinkIMAP(FakeIMAP):
    def uid(self, cmd, *a): return ("OK", [b"7 8"]) if cmd == "SEARCH" else ("OK", [(b"x", MSGS2[a[0]]), b")"])
os.environ.update(IMAP_FOLDER="INBOX", FROM_FILTER="")
zm.Mailbox._connect = lambda self: LinkIMAP()
lb = zm.Mailbox(zm.Config()); li = lb.refresh()
ok(len(li) == 1 and li[0]["name"] == "微信支付账单.zip" and lb.items[li[0]["id"]]["data"] == WX, "download link is followed and named from Content-Disposition: %s" % [i["name"] for i in li])
ok(all("evil.example" not in u for u in fetched) and "&amp;" not in fetched[0], "only allow-listed links are fetched (html entities decoded): %s" % fetched)
ok(len(lb.skipped) == 1 and "网页而不是文件" in lb.skipped[0]["reason"], "an expired link is reported, not imported: " + (lb.skipped[0]["reason"] if lb.skipped else ""))
ok(not zm.host_allowed("https://tenpay.wechatpay.cn.evil.com/x") and zm.host_allowed("https://x.tenpay.com/y") and not zm.host_allowed("http://tenpay.com/"), "host allow-list is strict")
print("all server tests passed")
