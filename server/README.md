# 资产线 · 邮箱同步服务

装在你自己的服务器上。它用一个**专门收账单的邮箱**的 IMAP 授权码只读登录邮箱，找到账单附件（.zip / .xlsx / .xls / .csv / .pdf），
在网页版「导入账单 → 从邮箱获取」时把原始文件交给手机。服务器不解压、不解析、不保存账单，解析仍在手机上完成。

只用 Python 标准库，适用于 Debian / Ubuntu。

## 安装

1. **准备专用邮箱并开启 IMAP**（以 QQ 邮箱为例）：网页版 QQ 邮箱 → 设置 → 账号与安全（旧版为「账户」）→
   开启「IMAP/SMTP 服务」→ 按提示生成**授权码**。授权码不是 QQ 密码，可以随时在同一处作废。
2. **添加域名解析**：在域名服务商处加一条 A 记录，比如 `bills.你的域名` 指向服务器 IP。
3. **在服务器上运行**：

   ```bash
   apt-get install -y git
   git clone https://github.com/huatingshi/zichanxian.git
   cd zichanxian && sudo bash server/install.sh
   ```

   按提示填邮箱地址、授权码（输入时不显示）和域名。80/443 端口空闲时会自动装 Caddy 并申请 HTTPS 证书；
   已有 nginx 或面板占用端口时，会打印一段反向代理配置，加到现有网页服务器里即可。
4. 安装结束会显示**服务地址**和**访问口令**。在手机上打开网页版 <https://huatingshi.github.io/zichanxian/>，
   「数据 → 邮箱同步」里填入，点「测试并保存」。
5. 以后在微信、支付宝、中国银行导出账单时，收件邮箱填这个专用邮箱。

## 日常维护

- 更新：`cd zichanxian && git pull && sudo bash server/install.sh`（保留已有设置）
- 看日志：`journalctl -u zichanxian-mail -f`
- 改设置：编辑 `/etc/zichanxian-mail.env` 后 `systemctl restart zichanxian-mail`
- 换口令：把 `ACCESS_TOKEN` 改成新的随机串（`python3 -c 'import secrets; print(secrets.token_urlsafe(32))'`），重启服务，再在手机上重新填
- 卸载：`systemctl disable --now zichanxian-mail && rm -rf /opt/zichanxian-mail /etc/zichanxian-mail.env /etc/systemd/system/zichanxian-mail.service`，
  并在邮箱设置里作废授权码

## 安全

- 授权码只保存在服务器的 `/etc/zichanxian-mail.env`（仅 root 和服务账户可读），不会出现在网页或 GitHub 上。
- 服务只监听本机 `127.0.0.1:8787`，外部只能经 HTTPS 访问；每个请求必须带访问口令，连续输错 10 次会封禁该 IP 15 分钟。
- 只允许你的网页地址（`ALLOW_ORIGIN`）从浏览器调用；只读打开收件箱，不删除、不发送邮件。
- 用专门的账单邮箱，万一服务器出问题，暴露的也只有账单；微信、支付宝的账单本身是加密压缩包。

## 测试

`python3 tests/test_server.py` 用模拟邮箱测试接口、权限和附件筛选。
