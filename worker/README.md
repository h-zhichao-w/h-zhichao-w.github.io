# 访客足迹统计 Worker

部署步骤（约 10 分钟，全程免费）：

1. 注册/登录 https://dash.cloudflare.com
2. 创建 KV 命名空间：Storage & Databases → KV → Create，命名 `visits`
3. 创建 Worker：Workers & Pages → Create → Hello World，命名如 `visitor-map`
4. 把 `worker.js` 的全部内容粘贴进 Worker 的在线编辑器（替换默认代码），Deploy
5. Worker 设置 → Bindings → 添加：
   - KV Namespace：变量名 `VISITS`，选择第 2 步创建的 `visits`
   - Secret：变量名 `SALT`，值填任意随机字符串（如 `python3 -c "import secrets;print(secrets.token_hex(16))"` 生成）
6. 浏览器访问 `https://visitor-map.<你的子域>.workers.dev/collect`，
   返回空白（204）即部署成功
7. 把 `https://visitor-map.<你的子域>.workers.dev` 填到仓库 `config.yml`
   的 `params.visitorMap.endpoint`（去掉注释），推送后首页即出现访客足迹地图

数据说明：
- 只保存城市级坐标、城市名和国家代码，访客每天最多计一次
- 不存储、不输出任何 IP 或可回溯个人的信息
- 免费额度：每天 10 万次请求，个人站点绰绰有余
