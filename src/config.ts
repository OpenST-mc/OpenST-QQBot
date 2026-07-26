// 应用配置模块
// 所有配置从环境变量读取，不硬编码敏感信息

// QQ Bot 凭证
export const QQ_APP_ID = process.env['QQ_APP_ID'] || ''
export const QQ_APP_SECRET = process.env['QQ_APP_SECRET'] || ''

// 群组白名单（逗号分隔的 QQ 群号或 group_openid）
// 仅白名单内的群可使用 bot 命令，空白则不限制
// 在目标群发 /ping 可获取 group_openid 和 group_id
export const QQ_GROUP_WHITELIST = parseCsvSet('QQ_GROUP_WHITELIST')

// 用户白名单（逗号分隔的用户 openid）
// 仅白名单内的用户可在私聊中使用 bot 命令，空白则不限制
// 向 bot 私发 /ping 可获取自己的 user openid
export const QQ_USER_WHITELIST = parseCsvSet('QQ_USER_WHITELIST')

// /learn 命令专用白名单（逗号分隔的群号/group_openid/用户 openid）
// 独立于通用白名单，仅控制 /learn 命令的使用权限
// 空白则不限制
export const QQ_LEARN_WHITELIST = parseCsvSet('QQ_LEARN_WHITELIST')

function parseCsvSet(envKey: string): Set<string> {
  const raw = process.env[envKey] || ''
  if (!raw.trim()) {
    return new Set()
  }
  return new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  )
}

// DeepSeek API 配置
export const DEEPSEEK_API_KEY = process.env['DEEPSEEK_API_KEY'] || ''
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'
export const DEEPSEEK_MODEL = 'deepseek-v4-pro'

// 上传服务配置
// 令牌有效期 5 分钟；缩短是为了压缩令牌泄露后可被重放使用的时间窗口
// 必须与 upload-frontend/api/validate.js、upload-frontend/api/submit.js 中的
// TOKEN_TTL_MS 保持一致——三处分属不同部署环境，无法共享同一份源码，
// 修改其中一处时必须同步修改另外两处，否则会出现验证失败
export const UPLOAD_TOKEN_EXPIRY_MS = 5 * 60 * 1000

// 上传前端页面部署地址（Vercel）
export const UPLOAD_FRONTEND_URL =
  process.env['UPLOAD_FRONTEND_URL'] || ''

// Worker API 地址（投稿中继），作为上传 API 路由传给前端
export const WORKER_URL = process.env['WORKER_URL'] || 'https://api.openstmc.com'

// 本地机器数据库路径
export const DATABASE_PATH = 'public/database/database.json'
export const SHARE_BASE_URL = 'https://openstmc.com/api/share?'

// 文件路径
export const GLOSSARY_CSV_PATH = 'public/database/TechMC Glossary.csv'
export const SOURCE_DATABASE_PATH = 'public/database/source'
export const AI_AGENT_PROMPT_PATH = 'agent/AGENTS.md'

// 联网搜索配置
// 最大返回结果数
export const SEARCH_MAX_RESULTS =
  isNaN(parseInt(process.env['SEARCH_MAX_RESULTS'] || '', 10))
    ? 5
    : parseInt(process.env['SEARCH_MAX_RESULTS'] || '5', 10)
// 自定义搜索后端 URL（SearXNG JSON API 格式，如 https://searx.example.com）
// 为空则使用 DuckDuckGo HTML Lite（免费，无需 API key）
export const SEARCH_CUSTOM_URL = process.env['SEARCH_CUSTOM_URL'] || ''
// 是否启用 AI 结果摘要，默认开启
export const SEARCH_AI_SUMMARIZE =
  process.env['SEARCH_AI_SUMMARIZE'] !== 'false'
// /ask 命令是否默认注入联网搜索结果，SEARCH_IN_ASK=false 关闭
export const SEARCH_IN_ASK = process.env['SEARCH_IN_ASK'] !== 'false'
// 联网搜索总开关，默认关闭
export const SEARCH_ENABLED = process.env['SEARCH_ENABLED'] === 'true'

// 投稿审核系统配置
// 接收新稿件通知的群组 openid
export const SUBMISSIONS_AC = process.env['SUBMISSIONS_AC'] || ''
// 审核人员名单（逗号分隔的用户 openid）
export const SUBMISSIONS_REVIEWERS = parseCsvSet('SUBMISSIONS_REVIEWERS')
// GitHub Token（需有 Submissions repo + website repo 权限）
export const SUBMISSIONS_GH_TOKEN =
  process.env['SUBMISSIONS_GH_TOKEN'] || process.env['GITHUB_TOKEN'] || ''
// 轮询间隔秒数，默认 60
export const SUBMISSIONS_POLL_INTERVAL_S =
  isNaN(parseInt(process.env['SUBMISSIONS_POLL_INTERVAL_S'] || '', 10))
    ? 60
    : parseInt(process.env['SUBMISSIONS_POLL_INTERVAL_S'] || '60', 10)
// 新稿件通知时 @ 提示最闲审核人数，默认 2
export const SUBMISSIONS_AT_COUNT =
  isNaN(parseInt(process.env['SUBMISSIONS_AT_COUNT'] || '', 10))
    ? 2
    : parseInt(process.env['SUBMISSIONS_AT_COUNT'] || '2', 10)

// QQ API 端点
export const QQ_API_BASE = 'https://api.sgroup.qq.com'
export const QQ_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'
