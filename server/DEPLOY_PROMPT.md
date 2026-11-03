# 给本地 AI 的部署提示词

把下面整段复制给你电脑上的 AI 助手（它需要能读取本机文件、能 SSH 到服务器）。方括号里的内容先换成你自己的。

---

你是我的运维助手。请帮我在我的香港云服务器（Debian）上部署「资产线 · 邮箱同步服务」。

## 背景
- 服务器的连接信息记在我电脑上的 `E:\mjj_manager` 里，请自己读取并 SSH 登录。不要在回复里复述服务器密码或私钥。
- 项目是公开仓库 https://github.com/huatingshi/zichanxian ，服务端代码在 `server/`，详细说明见 `server/README.md`。
- 这个服务用 IMAP 授权码**只读**登录我的 QQ 邮箱，把账单附件（zip / xlsx / csv / pdf）交给手机网页 https://huatingshi.github.io/zichanxian/ 。它只监听 `127.0.0.1:8787`，需要一个 HTTPS 域名反向代理到它。
- 只用 Python 标准库，不需要 pip。

## 已知信息
- 域名：[bills.你的域名]
- 邮箱：[你的 QQ 邮箱地址]
- 只读的文件夹：[其他文件夹/账单]（我会在 QQ 邮箱里建「账单」文件夹并设收信规则；不确定准确名字时，装好后用 `check.sh` 查看）
- 发件人过滤：留空

## 关于授权码（重要）
**不要让我在聊天里把授权码发给你，也不要把它写进命令行参数、脚本、git 或日志。**
安装脚本没有终端时会写入占位符。装完后提醒我自己登录服务器执行 `sudo nano /etc/zichanxian-mail.env`，把 `IMAP_PASS=` 后面换成授权码，再执行 `sudo systemctl restart zichanxian-mail`。

## 步骤
1. **先检查，不改动**：SSH 登录后汇总给我：系统版本、`ss -ltnp` 里已占用的端口和对应程序、是否已有 nginx / Caddy / 面板（x-ui、宝塔、1Panel 等）、防火墙状态（ufw / iptables / 云厂商安全组提示）、内存和磁盘。
2. **确认域名解析**：`dig +short [域名]` 应该是这台服务器的公网 IP。不是的话，告诉我要在域名服务商那里加什么 A 记录，等我确认后再继续。
3. **安装**：
   ```bash
   apt-get install -y git
   git clone https://github.com/huatingshi/zichanxian.git /root/zichanxian || git -C /root/zichanxian pull
   cd /root/zichanxian
   IMAP_USER='[邮箱]' IMAP_FOLDER='[文件夹]' DOMAIN='[域名]' bash server/install.sh
   ```
   - 80 和 443 都空闲时，脚本会自动安装 Caddy 并申请证书。
   - 如果 80/443 已被占用：**不要停止或改动现有服务的已有站点**。按脚本打印的提示，在现有的 nginx / Caddy / 面板里**新增**一个站点，把 `https://[域名]` 反向代理到 `http://127.0.0.1:8787`，并配好证书。改之前先备份配置文件，nginx 改完先 `nginx -t` 再重载。
   - 有防火墙时，确保 80、443 对外开放（申请证书需要 80），**8787 不要对外开放**。
4. **验证**（每项告诉我结果）：
   - `systemctl is-active zichanxian-mail` 是 `active`
   - `curl -s https://[域名]/api/health` 返回 `{"ok": true}`
   - `curl -s -o /dev/null -w '%{http_code}\n' https://[域名]/api/attachments` 返回 `401`（没带口令应被拒绝）
   - 从服务器外访问 `http://[服务器IP]:8787` 连不上
   - 我填好授权码后，运行 `sudo bash /root/zichanxian/server/check.sh`，确认能登录、列出文件夹、找到账单附件。如果提示打不开文件夹，从它列出的文件夹名里选对的，改 `/etc/zichanxian-mail.env` 里的 `IMAP_FOLDER`，然后重启服务。
5. **最后给我**：
   - 服务地址 `https://[域名]`
   - 访问口令：安装脚本最后打印的那串，也可以用 `sudo grep ACCESS_TOKEN /etc/zichanxian-mail.env` 查看。我要把它填到手机上。
   - 你新建或修改过的所有文件清单，以及怎么撤销。

## 约束
- 不要修改与本服务无关的配置和服务；任何可能中断现有服务的操作，先问我。
- 不要升级系统或重启服务器。
- 授权码、服务器密码、访问口令不要写进 git 仓库，也不要上传到任何地方。
