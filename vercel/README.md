# Visitor Map — Vercel 部署

替代 Cloudflare Worker（`workers.dev` 在国内被阻断），改用 Vercel Serverless Functions + KV 存储。

## 前置条件

- [Vercel](https://vercel.com) 账号（免费 Hobby 计划即可）
- 本机已安装 Node.js 18+

## 部署步骤

### 1. 登录 Vercel CLI

```bash
cd vercel
npm install
npx vercel login
```

### 2. 创建 KV 数据库

在 Vercel 控制台：
1. 进入 **Storage** → **Create Database** → 选择 **KV**
2. 名称填 `visitor-store`（或任意名称，不超过 32 字符）
3. 选择离你最近的区域（如 `ap-northeast-1` 东京）
4. 点 **Create & Continue** → **Connect** 关联到项目

### 3. 添加 SALT 环境变量

在 Vercel 控制台 → 项目 → **Settings → Environment Variables**：
- Key: `SALT`
- Value: 任意随机字符串（用于访客去重哈希）
- 勾选所有环境（Production + Preview + Development）

可在本机生成随机值：`node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`

### 4. 部署

```bash
npx vercel --prod
```

部署完成后终端会输出生产 URL，形如 `https://visitor-map-xxx.vercel.app`。

### 5. 更新站点配置

把 `config.yml` 中的 `visitorMap.endpoint` 改为上一步得到的 URL（去掉末尾斜杠）：

```yaml
visitorMap:
  endpoint: "https://visitor-map-xxx.vercel.app"
```

### 6. 验证

- 访问 `https://<你的部署域名>/locations` → 应返回 `{"locations":[]}`
- 访问 `https://<你的部署域名>/collect` → 应返回空白（HTTP 204）
- 打开你的站点 `https://h-zhichao-w.github.io/` → 地图组件应正常显示

## 技术说明

- 地理位置数据来自 Vercel Edge 网络请求头（`x-vercel-ip-latitude` / `x-vercel-ip-longitude` 等），城市级精度
- 存储使用 Vercel KV（Redis），免费额度包含 256MB 存储
- 同一访客每天只计一次（SHA256(SALT + IP + 日期)）
- 代码结构：`api/collect.ts`（记录访问）+ `api/locations.ts`（返回聚合数据）
- `vercel.json` 中的 rewrites 把 `/collect` 和 `/locations` 映射到 `/api/collect` 和 `/api/locations`