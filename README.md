# Zhichao's Homepage (Hugo + PaperMod)

使用 Hugo + PaperMod 驱动的个人主页示例，仓库已经配置好 GitHub Pages 发布流程。

## 快速开始
- 安装 [Hugo Extended](https://gohugo.io/installation/) `>= 0.146.0`。
- 克隆后执行 `git submodule update --init --recursive` 拉取主题。
- 本地预览：`hugo server -D`（修改内容后浏览器自动刷新）。
- 主要配置在 `config.yml`，文章在 `content/posts`。

## 自定义项
- `config.yml`：站点标题、描述、菜单、社交链接（把 `me@example.com` 换成你的邮箱或删除该条）、主页介绍文案。
- `assets/css/extended/custom.css`：少量样式覆盖。
- `content/posts`：删除示例文章，按需新建 Markdown 文件。

## 部署到 GitHub Pages
- 已在 `.github/workflows/gh-pages.yml` 配置 Actions：push 到 `exampleSite` 分支会自动构建并发布。
- 在 GitHub 仓库设置中把 Pages 的 Source 设为 “GitHub Actions”。
- 首次推送前确保主题子模块已更新：`git submodule update --init --recursive`。

## 常用命令
- 本地启动：`hugo server -D`
- 生产构建：`hugo --gc --minify`

如果想基于该模板做二次修改，只需继续编辑 `config.yml`、内容与样式后推送到 `exampleSite` 分支即可。
