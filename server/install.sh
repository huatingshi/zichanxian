#!/usr/bin/env bash
# 资产线 · 邮箱同步服务 一键安装（Debian / Ubuntu）
# 用法：在仓库目录里执行  sudo bash server/install.sh
# 再次运行会更新程序，保留已有设置；想重新填写设置，先删除 /etc/zichanxian-mail.env
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "请用 root 运行：sudo bash server/install.sh"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
APP=/opt/zichanxian-mail
ENVF=/etc/zichanxian-mail.env
SVC=zichanxian-mail
PORT=8787

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
HAS_TTY=0; { : </dev/tty; } 2>/dev/null && HAS_TTY=1
# ask "提示" "默认值"：有终端就问，没有终端（比如被其他程序远程调用）就用默认值
ask() { local v=""; if [ "$HAS_TTY" = 1 ]; then read -rp "$1" v </dev/tty; fi; printf '%s' "${v:-$2}"; }

say "1/4 安装依赖"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3 ca-certificates curl gnupg iproute2 >/dev/null

say "2/4 安装程序"
id zcxmail &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin zcxmail
install -d -m 755 "$APP"
install -m 644 "$HERE/zichanxian_mail.py" "$APP/zichanxian_mail.py"

# 设置可以预先用环境变量给出（IMAP_USER IMAP_HOST IMAP_FOLDER FROM_FILTER DOMAIN ALLOW_ORIGIN），
# 授权码只在终端里输入；没有终端时写入占位符，之后用 sudo nano /etc/zichanxian-mail.env 自己填。
if [ ! -f "$ENVF" ]; then
  say "3/4 填写设置（只保存在这台服务器的 $ENVF）"
  MAIL_USER="${IMAP_USER:-$(ask '收账单的邮箱地址：' '')}"
  [ -n "$MAIL_USER" ] || { echo "需要邮箱地址：在终端里运行，或先 export IMAP_USER=你的邮箱"; exit 1; }
  MAIL_PASS=""
  if [ "$HAS_TTY" = 1 ]; then read -rsp '这个邮箱的 IMAP 授权码（输入时不显示，回车跳过以后再填）：' MAIL_PASS </dev/tty; echo; fi
  MAIL_PASS="${MAIL_PASS:-请在这里填写授权码}"
  if [ -z "${IMAP_HOST:-}" ]; then
    case "${MAIL_USER##*@}" in
      qq.com|foxmail.com|vip.qq.com) IMAP_HOST=imap.qq.com ;;
      163.com) IMAP_HOST=imap.163.com ;;
      126.com) IMAP_HOST=imap.126.com ;;
      yeah.net) IMAP_HOST=imap.yeah.net ;;
      outlook.com|hotmail.com|live.com) IMAP_HOST=outlook.office365.com ;;
      gmail.com) IMAP_HOST=imap.gmail.com ;;
      *) IMAP_HOST="$(ask '邮箱的 IMAP 服务器地址（例如 imap.example.com）：' '')" ;;
    esac
  fi
  FOLDER="${IMAP_FOLDER:-$(ask '读取哪个文件夹（直接回车 = 收件箱 INBOX）：' 'INBOX')}"
  FROMS="${FROM_FILTER:-$(ask '只读这些发件人的邮件，逗号分隔（直接回车 = 不限）：' '')}"
  DOMAIN="${DOMAIN:-$(ask '给这个服务用的域名（例如 bills.example.com，需已解析到本机）：' '')}"
  [ -n "$DOMAIN" ] || { echo "需要域名：在终端里运行，或先 export DOMAIN=bills.example.com"; exit 1; }
  ORIGIN="${ALLOW_ORIGIN:-$(ask '网页地址（直接回车用 https://huatingshi.github.io）：' 'https://huatingshi.github.io')}"
  TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  umask 077
  cat > "$ENVF" <<EOF
IMAP_HOST=$IMAP_HOST
IMAP_PORT=993
IMAP_USER=$MAIL_USER
IMAP_PASS=$MAIL_PASS
IMAP_FOLDER=$FOLDER
FROM_FILTER=$FROMS
ACCESS_TOKEN=$TOKEN
ALLOW_ORIGIN=$ORIGIN
LISTEN=127.0.0.1:$PORT
DAYS=120
MAX_MESSAGES=200
DOMAIN=$DOMAIN
EOF
  chown root:zcxmail "$ENVF"; chmod 640 "$ENVF"
else
  say "3/4 沿用已有设置 $ENVF"
fi
# shellcheck disable=SC1090
DOMAIN="$(grep -E '^DOMAIN=' "$ENVF" | cut -d= -f2-)"
TOKEN="$(grep -E '^ACCESS_TOKEN=' "$ENVF" | cut -d= -f2-)"

cat > /etc/systemd/system/$SVC.service <<EOF
[Unit]
Description=资产线 邮箱同步服务
After=network-online.target
Wants=network-online.target

[Service]
User=zcxmail
Group=zcxmail
EnvironmentFile=$ENVF
ExecStart=/usr/bin/python3 $APP/zichanxian_mail.py
Restart=on-failure
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
MemoryMax=256M

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now $SVC >/dev/null
systemctl restart $SVC
sleep 1
systemctl is-active --quiet $SVC || { echo "服务没有启动成功，查看原因：journalctl -u $SVC -n 50"; exit 1; }

say "4/4 配置 HTTPS（$DOMAIN）"
SITE="$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}"
if command -v caddy >/dev/null; then
  grep -qF "$DOMAIN {" /etc/caddy/Caddyfile 2>/dev/null || printf '\n%s\n' "$SITE" >> /etc/caddy/Caddyfile
  systemctl reload caddy && echo "已加入现有的 Caddy 配置"
elif ss -ltn | grep -qE ':(80|443) '; then
  echo "80 或 443 端口已被其他程序（比如 nginx 或面板）占用，没有自动安装 Caddy。"
  echo "请在现有的网页服务器里加一个反向代理：https://$DOMAIN  →  http://127.0.0.1:$PORT"
  echo "nginx 示例（证书路径按你的实际情况填）："
  cat <<EOF
  server {
      listen 443 ssl;
      server_name $DOMAIN;
      ssl_certificate     /path/to/fullchain.pem;
      ssl_certificate_key /path/to/privkey.pem;
      location / { proxy_pass http://127.0.0.1:$PORT; proxy_set_header X-Forwarded-For \$remote_addr; }
  }
EOF
else
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy >/dev/null
  printf '%s\n' "$SITE" > /etc/caddy/Caddyfile
  systemctl restart caddy && echo "已安装 Caddy，会自动申请 HTTPS 证书"
fi

if grep -q '^IMAP_PASS=请在这里填写授权码' "$ENVF"; then
  say "还差授权码：运行 sudo nano $ENVF ，把 IMAP_PASS= 后面换成授权码，保存后运行 sudo systemctl restart $SVC"
fi

say "完成。在资产线网页版「数据 → 邮箱同步」里填："
echo "  服务地址：https://$DOMAIN"
echo "  访问口令：$TOKEN"
echo
echo "自检：curl -s https://$DOMAIN/api/health   应返回 {\"ok\": true}"
echo "检查邮箱：sudo bash $HERE/check.sh   （列出文件夹和找到的账单附件）"
echo "看日志：journalctl -u $SVC -f"
