# GitHub 仓库体检 🔬

一键输入 GitHub 仓库地址，自动分析并可视化展示仓库健康指标，并可选接入 Claude AI 给出综合评分。

## 功能

- ⭐ 基础指标：Stars、Forks、Watchers、Open Issues
- 🥧 编程语言分布（环形图）
- 📊 近 12 周提交活动（柱状图）
- 👥 Top 10 贡献者列表
- 🤖 AI 综合评分（需配置 ANTHROPIC_API_KEY）

## 快速启动

### 1. 安装依赖

```bash
cd github-health-check
pip install -r requirements.txt
```

### 2. 配置环境变量（可选但推荐）

```bash
# Windows PowerShell
$env:GITHUB_TOKEN="ghp_xxxxxxxxxxxx"       # 提升 GitHub API 配额 60→5000次/小时
$env:ANTHROPIC_API_KEY="sk-ant-xxxxxxxx"   # 启用 AI 评分功能

# macOS / Linux
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
export ANTHROPIC_API_KEY="sk-ant-xxxxxxxx"
```

### 3. 启动服务

```bash
uvicorn main:app --reload
```

浏览器访问 → http://localhost:8000

## 项目结构

```
github-health-check/
├── main.py          # FastAPI 后端（GitHub API + Claude AI）
├── index.html       # 前端页面（Chart.js，无需构建）
├── requirements.txt
└── README.md
```

## 技术栈

| 层次 | 技术 |
|------|------|
| 后端 | FastAPI + httpx（异步并发） |
| AI   | Anthropic Claude claude-sonnet-4-6 |
| 前端 | 原生 HTML/CSS/JS + Chart.js（CDN） |

## 注意事项

- 未配置 `GITHUB_TOKEN` 时，GitHub API 限速为 60 次/小时
- 部分仓库的提交统计首次请求会返回空（GitHub 异步计算），刷新重试即可
- 私有仓库无法访问
