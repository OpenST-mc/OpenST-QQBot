// 投稿审核模块配置
// 重新导出主配置 + GitHub 仓库常量
import {
  SUBMISSIONS_AC,
  SUBMISSIONS_REVIEWERS,
  SUBMISSIONS_GH_TOKEN,
  SUBMISSIONS_POLL_INTERVAL_S,
  SUBMISSIONS_AT_COUNT
} from '../config'

export {
  SUBMISSIONS_AC,
  SUBMISSIONS_REVIEWERS,
  SUBMISSIONS_GH_TOKEN,
  SUBMISSIONS_POLL_INTERVAL_S,
  SUBMISSIONS_AT_COUNT
}

// GitHub 仓库常量
export const SUBMISSIONS_REPO_OWNER = 'OpenST-mc'
export const SUBMISSIONS_REPO_NAME = 'Submissions'
export const WEBSITE_REPO_OWNER = 'OpenST-mc'
export const WEBSITE_REPO_NAME = 'website'
export const WEBSITE_ARCHIVE_PATH = 'archive/archive'

// GitHub Issues API 基础 URL
export const GH_API_BASE = 'https://api.github.com'
