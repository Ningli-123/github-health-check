import os
import re
import json
import asyncio
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import httpx
import anthropic

app = FastAPI(title="GitHub Repo Health Check")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")


def parse_github_url(url: str) -> tuple[str, str]:
    url = url.strip().rstrip("/")
    match = re.search(r"github\.com/([^/\s]+)/([^/\s?#]+)", url)
    if not match:
        raise ValueError("无效的 GitHub 仓库 URL，格式应为 https://github.com/owner/repo")
    return match.group(1), match.group(2)


async def fetch(client: httpx.AsyncClient, url: str, headers: dict):
    try:
        r = await client.get(url, headers=headers, timeout=15.0)
        if r.status_code == 200:
            return r.json()
        return None
    except Exception:
        return None


async def get_ai_score(repo: dict, languages: dict, contributors: list, releases: list) -> dict | None:
    if not ANTHROPIC_API_KEY:
        return None
    try:
        info = {
            "name": repo.get("full_name"),
            "stars": repo.get("stargazers_count"),
            "forks": repo.get("forks_count"),
            "open_issues": repo.get("open_issues_count"),
            "description": repo.get("description"),
            "license": repo.get("license", {}).get("name") if repo.get("license") else None,
            "topics": repo.get("topics", []),
            "has_wiki": repo.get("has_wiki"),
            "created_at": repo.get("created_at"),
            "pushed_at": repo.get("pushed_at"),
            "contributors_count": len(contributors),
            "releases_count": len(releases),
            "languages": list(languages.keys()) if languages else [],
        }
        ac = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        msg = ac.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=800,
            messages=[{
                "role": "user",
                "content": f"""你是专业的开源项目评估专家。根据以下 GitHub 仓库数据进行综合评分。
数据：{json.dumps(info, ensure_ascii=False)}

请严格返回 JSON 格式（不要有任何其他内容）：
{{"score":85,"grade":"A","dimensions":{{"community":90,"activity":80,"documentation":85,"maturity":88}},"summary":"项目总体评价（30字以内）","highlights":["亮点1","亮点2"],"risks":["风险1"]}}

等级标准：S≥90, A≥80, B≥70, C≥60, D<60"""
            }]
        )
        text = msg.content[0].text.strip()
        m = re.search(r'\{.*\}', text, re.DOTALL)
        return json.loads(m.group() if m else text)
    except Exception as e:
        print(f"[AI] 评分失败: {e}")
        return None


@app.get("/")
def index():
    return FileResponse("index.html")


@app.get("/api/analyze")
async def analyze(url: str = Query(..., description="GitHub 仓库 URL")):
    try:
        owner, repo = parse_github_url(url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    headers = {"Accept": "application/vnd.github.v3+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"

    base = f"https://api.github.com/repos/{owner}/{repo}"

    async with httpx.AsyncClient() as client:
        repo_r, lang_r, contrib_r, activity_r, releases_r = await asyncio.gather(
            fetch(client, base, headers),
            fetch(client, f"{base}/languages", headers),
            fetch(client, f"{base}/contributors?per_page=10&anon=0", headers),
            fetch(client, f"{base}/stats/commit_activity", headers),
            fetch(client, f"{base}/releases?per_page=5", headers),
        )

    if not repo_r:
        raise HTTPException(status_code=404, detail="仓库不存在或无法访问（可能是私有仓库）")

    contributors = []
    if isinstance(contrib_r, list):
        contributors = [
            {
                "login": c.get("login"),
                "avatar_url": c.get("avatar_url"),
                "contributions": c.get("contributions"),
                "html_url": c.get("html_url"),
            }
            for c in contrib_r[:10]
        ]

    commit_data = []
    if isinstance(activity_r, list) and activity_r:
        commit_data = [{"week": w["week"], "total": w["total"]} for w in activity_r[-12:]]

    releases = releases_r if isinstance(releases_r, list) else []
    ai_score = await get_ai_score(repo_r, lang_r or {}, contributors, releases)

    return {
        "repo": {
            "full_name": repo_r.get("full_name"),
            "description": repo_r.get("description"),
            "html_url": repo_r.get("html_url"),
            "stars": repo_r.get("stargazers_count", 0),
            "forks": repo_r.get("forks_count", 0),
            "watchers": repo_r.get("subscribers_count", 0),
            "open_issues": repo_r.get("open_issues_count", 0),
            "created_at": repo_r.get("created_at"),
            "pushed_at": repo_r.get("pushed_at"),
            "license": repo_r.get("license", {}).get("name") if repo_r.get("license") else "无",
            "topics": repo_r.get("topics", []),
            "owner_avatar": repo_r.get("owner", {}).get("avatar_url"),
        },
        "languages": lang_r or {},
        "contributors": contributors,
        "commit_activity": commit_data,
        "releases_count": len(releases),
        "ai_score": ai_score,
    }
