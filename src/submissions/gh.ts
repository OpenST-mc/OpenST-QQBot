// GitHub API 操作封装
// 查询 issues、关闭 issue、上传文件到 website 仓库
import axios from 'axios'
import {
  SUBMISSIONS_GH_TOKEN,
  SUBMISSIONS_REPO_OWNER,
  SUBMISSIONS_REPO_NAME,
  WEBSITE_REPO_OWNER,
  WEBSITE_REPO_NAME,
  WEBSITE_ARCHIVE_PATH,
  GH_API_BASE
} from './config'
import { assertSafeRelativePath } from './pathSafety'

// 使用函数返回 headers 而非模块加载时冻结，确保 token 变更后可用
function getHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${SUBMISSIONS_GH_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'OpenST-QQBot'
  }
}

// GitHub Issue 数据结构
export interface GhIssue {
  number: number
  title: string
  body: string
  state: string
  created_at: string
  html_url: string
}

// 获取 Submissions 仓库的 open issue 列表（支持分页，最多 5 页共 100 条）
export async function fetchOpenIssues(): Promise<GhIssue[]> {
  const allIssues: GhIssue[] = []
  const headers = getHeaders()
  const baseUrl =
    `${GH_API_BASE}/repos/${SUBMISSIONS_REPO_OWNER}/${SUBMISSIONS_REPO_NAME}/issues`

  for (let page = 1; page <= 5; page++) {
    const url =
      `${baseUrl}?state=open&per_page=100&sort=created&direction=desc&page=${page}`

    const resp = await axios.get(url, { headers })
    const issues = resp.data as Array<Record<string, unknown>>
    if (issues.length === 0) break

    for (const issue of issues) {
      allIssues.push({
        number: issue['number'] as number,
        title: String(issue['title'] || ''),
        body: String(issue['body'] || ''),
        state: String(issue['state'] || ''),
        created_at: String(issue['created_at'] || ''),
        html_url: String(issue['html_url'] || '')
      })
    }

    // 如果返回不足一页，说明已到末尾
    if (issues.length < 100) break
  }

  return allIssues
}

// 关闭 issue 为 completed
export async function closeIssueAsCompleted(issueNumber: number): Promise<void> {
  const url =
    `${GH_API_BASE}/repos/${SUBMISSIONS_REPO_OWNER}/${SUBMISSIONS_REPO_NAME}` +
    `/issues/${issueNumber}`

  await axios.patch(
    url,
    { state: 'closed', state_reason: 'completed' },
    { headers: getHeaders() }
  )

  console.log(
    `[Submissions] Issue #${issueNumber} 已关闭为 completed`
  )
}

// 关闭 issue 为 not_planned
export async function closeIssueAsNotPlanned(issueNumber: number): Promise<void> {
  const url =
    `${GH_API_BASE}/repos/${SUBMISSIONS_REPO_OWNER}/${SUBMISSIONS_REPO_NAME}` +
    `/issues/${issueNumber}`

  await axios.patch(
    url,
    { state: 'closed', state_reason: 'not_planned' },
    { headers: getHeaders() }
  )

  console.log(
    `[Submissions] Issue #${issueNumber} 已关闭为 not_planned`
  )
}

// 通过 GitHub Content API 上传单个文件到 website 仓库
export async function uploadFileToWebsite(
  filePath: string,
  contentBase64: string
): Promise<void> {
  // 纵深防御：即使上游调用方已校验，此处仍拒绝穿越出 WEBSITE_ARCHIVE_PATH 的路径
  assertSafeRelativePath(filePath)

  const apiPath = `${WEBSITE_ARCHIVE_PATH}/${filePath}`
  const encodedPath = apiPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  const url =
    `${GH_API_BASE}/repos/${WEBSITE_REPO_OWNER}/${WEBSITE_REPO_NAME}` +
    `/contents/${encodedPath}`

  const body = {
    message: `[bot] 审核通过: ${filePath}`,
    content: contentBase64
  }

  await axios.put(url, body, { headers: getHeaders() })

  console.log(`[Submissions] 已上传文件到 website: ${apiPath}`)
}
