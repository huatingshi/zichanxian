"""Runs server/zichanxian_mail.py against a fake mailbox holding the fixture bills. Prints the port.
Usage: python3 tests/fake_mail_server.py <allowed origin>"""
import email.message, os, sys
from http.server import ThreadingHTTPServer
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "server"))
os.environ.update(IMAP_HOST="imap.qq.com", IMAP_USER="bills@qq.com", IMAP_PASS="x", ACCESS_TOKEN="t" * 32, ALLOW_ORIGIN=sys.argv[1] if len(sys.argv) > 1 else "http://app.test", LISTEN="127.0.0.1:0")
import zichanxian_mail as zm
FIX = os.path.join(ROOT, "tests", "fixtures")
def msg(subject, name, path):
    m = email.message.EmailMessage(); m["From"] = "bills"; m["Subject"] = subject; m["Date"] = "Mon, 02 Nov 2026 10:00:00 +0800"; m.set_content("见附件")
    m.add_attachment(open(os.path.join(FIX, path), "rb").read(), maintype="application", subtype="octet-stream", filename=name); return m.as_bytes()
MSGS = {b"1": msg("微信支付账单", "微信支付账单(20261001-20261102).zip", "wx.zip"), b"2": msg("支付宝交易流水", "支付宝交易明细.zip", "ali.zip"), b"3": msg("中国银行交易流水", "交易流水.pdf", "boc.pdf")}
class FakeIMAP:
    def select(self, box, readonly=False): return "OK", [b"3"]
    def response(self, code): return code, [b"1"]
    def uid(self, cmd, *a): return ("OK", [b"1 2 3"]) if cmd == "SEARCH" else ("OK", [(b"x", MSGS[a[0]]), b")"])
    def logout(self): pass
zm.Mailbox._connect = lambda self: FakeIMAP()
cfg = zm.Config(); srv = ThreadingHTTPServer(("127.0.0.1", 0), zm.make_handler(cfg, zm.Mailbox(cfg), zm.Guard()))
print(srv.server_address[1], flush=True); srv.serve_forever()
