# 资产线

单页记账工具：导入微信（.xlsx）、支付宝（.csv）、中国银行（.pdf）账单或带密码的 .zip，
在本机画出像股价一样涨跌的总资产曲线；支持随手记一笔、自动分类与饼图、信用卡分期还款提醒、订阅管理。
账单在浏览器里解析，数据只保存在本机浏览器里，不会上传。

在线使用：<https://huatingshi.github.io/zichanxian/>
（iPhone 上用 Safari 打开，点分享 →「添加到主屏幕」，之后像 App 一样全屏使用。）

## 目录

- `src/`：页面源码，按顺序拼接成一个页面
  - `page.html` 样式与页面结构，`state.js` 数据与分类规则，`views.js` 走势与明细，
    `parse.js` 账单解析，`features.js` 导入、记账、分类、还款、订阅
- `tools/build.py`：生成两个版本
  - `index.html`：GitHub Pages 用的完整网页（带主屏幕图标和全屏设置）
  - `build/artifact.html`：发布到 Claude Artifact 用的版本
- `icons/`、`manifest.webmanifest`：主屏幕图标与应用信息
- `server/`：可选的邮箱同步服务，装在自己的服务器上，见 [server/README.md](server/README.md)
- `design/directions.html`：三个设计方向的样稿
- `tests/fixtures/`：合成的测试账单（非真实数据）；`tests/mkfx.py`、`tests/mkwx.js` 是生成脚本
- `tests/e2e.js`：端到端测试

## 修改与发布

```bash
python3 tools/build.py
```

改完 `src/` 后运行上面的命令，提交并推送到 `main`，GitHub Pages 会自动更新。

运行测试：在仓库根目录执行 `npm i playwright xlsx@0.18.5 @zip.js/zip.js@2.7.45 pdfjs-dist@3.11.174 geist@1.3.1`，
先运行 `python3 tools/build.py`，再运行 `node tests/e2e.js`；服务器端测试：`python3 tests/test_server.py`。
