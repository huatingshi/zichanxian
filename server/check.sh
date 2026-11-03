#!/usr/bin/env bash
# 用已保存的设置登录一次邮箱：列出服务器看到的文件夹名，以及找到的账单附件。不会修改任何东西。
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "请用 root 运行：sudo bash server/check.sh"; exit 1; }
ENVF=/etc/zichanxian-mail.env
[ -f "$ENVF" ] || { echo "还没有安装：先运行 sudo bash server/install.sh"; exit 1; }
set -a; . "$ENVF"; set +a
exec python3 /opt/zichanxian-mail/zichanxian_mail.py --check
