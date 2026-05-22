import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

// 从 .env 文件加载环境变量（本地开发用，不上传 git）
try {
  const lines = readFileSync(new URL('.env', import.meta.url), 'utf8').split('\n');
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq > 0 && !line.startsWith('#')) {
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (k && !process.env[k]) process.env[k] = v;
    }
  }
} catch { /* .env 不存在时忽略 */ }

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8001;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const AI_API_KEY   = process.env.AI_API_KEY   || '';
const AI_BASE_URL  = process.env.AI_BASE_URL  || 'https://api.deepseek.com';
const AI_MODEL     = process.env.AI_MODEL     || 'deepseek-chat';

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseGithubUrl(url) {
  const m = url.trim().replace(/\/$/, '').match(/github\.com\/([^/\s]+)\/([^/\s?#]+)/);
  if (!m) throw new Error('无效的 GitHub 仓库 URL，格式应为 https://github.com/owner/repo');
  return [m[1], m[2]];
}

async function ghFetch(url) {
  const headers = { Accept: 'application/vnd.github.v3+json' };
  if (GITHUB_TOKEN) headers.Authorization = `token ${GITHUB_TOKEN}`;
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (r.status === 200) return r.json();
    return null;
  } catch {
    return null;
  }
}

async function getAIScore(repoInfo, languages, contributors, releases) {
  if (!AI_API_KEY) return null;
  try {
    const info = {
      name:               repoInfo.full_name,
      stars:              repoInfo.stargazers_count,
      forks:              repoInfo.forks_count,
      open_issues:        repoInfo.open_issues_count,
      description:        repoInfo.description,
      license:            repoInfo.license?.name ?? null,
      topics:             repoInfo.topics ?? [],
      has_wiki:           repoInfo.has_wiki,
      created_at:         repoInfo.created_at,
      pushed_at:          repoInfo.pushed_at,
      contributors_count: contributors.length,
      releases_count:     releases.length,
      languages:          Object.keys(languages),
    };

    const resp = await fetch(`${AI_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `你是专业的开源项目评估专家。根据以下 GitHub 仓库数据进行综合评分。
数据：${JSON.stringify(info)}

请严格返回 JSON 格式（不要有任何其他内容）：
{"score":85,"grade":"A","dimensions":{"community":90,"activity":80,"documentation":85,"maturity":88},"summary":"项目总体评价（30字以内）","highlights":["亮点1","亮点2"],"risks":["风险1"]}

等级标准：S≥90, A≥80, B≥70, C≥60, D<60`,
        }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : text);
  } catch (e) {
    console.error('[AI] 评分失败:', e.message);
    return null;
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

app.get('/api/analyze', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ detail: '缺少 url 参数' });

  let owner, repo;
  try {
    [owner, repo] = parseGithubUrl(url);
  } catch (e) {
    return res.status(400).json({ detail: e.message });
  }

  const base = `https://api.github.com/repos/${owner}/${repo}`;

  const [repoR, langR, contribR, activityR, releasesR] = await Promise.all([
    ghFetch(base),
    ghFetch(`${base}/languages`),
    ghFetch(`${base}/contributors?per_page=10&anon=0`),
    ghFetch(`${base}/stats/commit_activity`),
    ghFetch(`${base}/releases?per_page=5`),
  ]);

  if (!repoR) {
    return res.status(404).json({ detail: '仓库不存在或无法访问（可能是私有仓库）' });
  }

  const contributors = Array.isArray(contribR)
    ? contribR.slice(0, 10).map(c => ({
        login: c.login,
        avatar_url: c.avatar_url,
        contributions: c.contributions,
        html_url: c.html_url,
      }))
    : [];

  const commitActivity = Array.isArray(activityR) && activityR.length
    ? activityR.slice(-12).map(w => ({ week: w.week, total: w.total }))
    : [];

  const releases = Array.isArray(releasesR) ? releasesR : [];
  const aiScore  = await getAIScore(repoR, langR ?? {}, contributors, releases);

  res.json({
    repo: {
      full_name:   repoR.full_name,
      description: repoR.description,
      html_url:    repoR.html_url,
      stars:       repoR.stargazers_count ?? 0,
      forks:       repoR.forks_count      ?? 0,
      watchers:    repoR.subscribers_count ?? 0,
      open_issues: repoR.open_issues_count ?? 0,
      created_at:  repoR.created_at,
      pushed_at:   repoR.pushed_at,
      license:     repoR.license?.name ?? '无',
      topics:      repoR.topics ?? [],
      owner_avatar: repoR.owner?.avatar_url,
    },
    languages:      langR ?? {},
    contributors,
    commit_activity: commitActivity,
    releases_count:  releases.length,
    ai_score:        aiScore,
  });
});

app.listen(PORT, () => console.log(`✅ Server running → http://localhost:${PORT}`));
