# 资产线

单页记账工具：导入微信（.xlsx）、支付宝（.csv）、中国银行（.pdf）账单或带密码的 .zip，
在本机画出像股价一样涨跌的总资产曲线；支持随手记一笔、自动分类与饼图、信用卡分期还款提醒、订阅管理。
数据只保存在浏览器本地。

- `index.html`：页面本体（发布为 Claude Artifact）。
- `tests/fixtures/`：合成的测试账单（非真实数据）。
- `tests/mkfx.py`、`tests/mkwx.js`：生成测试账单的脚本。
