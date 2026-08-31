# Visitor Map — Vercel 部署

替代 Cloudflare Worker（`workers.dev` 在国内被阻断），改用 Vercel Serverless Functions + Upstash Redis。

## 前置条件

- [Vercel](https://vercel.com) 账号（免费 Hobby 计划即可）
- [Upstash](https://upstash.com) 账号（免费计划：10,000 条命令/天，256MB 存储，完全够用）
- 本机已安装 Node.js 18+

## 部署步骤

### 1. 创建 Upstash Redis 数据库

1. 登录 [Upstash 控制台](https://console.upstash.com)
2. 点 **Create Database**
3. 名称填 `visitor-store`，类型选 **Global**（多区域，延迟更低）或 **Regional**（单区域，免费额度更多）
4. 区域选 `ap-northeast-1`（东京，离中国近）
5. 点 **Create**

创建完成后，记下：
- **REST URL**（形如 `https://xxx.upstash.io`）
- **REST Token**（`xxxxx...`）

### 2. 部署到 Vercel

```bash
cd vercel
npm install
npx vercel login          # 浏览器登录
npx vercel link           # 关联项目
npx vercel env add UPSTASH_REDIS_REST_URL   # 填第 1 步的 REST URL
npx vercel env add UPSTASH_REDIS_REST_TOKEN # 填第 1 步的 REST Token
npx vercel env add SALT production           # 任意随机字符串
npx vercel --prod
```

部署完成后终端会输出生产 URL，形如 `https://visitor-map-xxx.vercel.app`。

### 3. 更新站点配置

把 `config.yml` 中的 `visitorMap.endpoint` 改为上一步得到的 URL（去掉末尾斜杠）：

```yaml
visitorMap:
  endpoint: "https://visitor-map-xxx.vercel.app"
```

### 4. 验证

- 访问 `https://<你的部署域名>/locations` → 应返回 `{"locations":[]}`
- 访问 `https://<你的部署域名>/collect` → 应返回空白（HTTP 204）
- 打开你的站点 → 地图组件应正常显示

## 技术说明

- 地理位置：Vercel Edge 网络请求头（`x-vercel-ip-latitude` / `x-vercel-ip-longitude` 等），城市级精度
- 存储：Upstash Redis（免费额度 10,000 命令/天，256MB）
- 去重：同一访客每天只计一次（SHA256(SALT + IP + 日期)）
- 路由：`vercel.json` rewrites 把 `/collect` 和 `/locations` 映射到 `/api/collect` 和 `/api/locations`