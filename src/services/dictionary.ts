/**
 * 专业术语知识库服务
 * 加载 public/database/dictionary/config.json + entries/ + zh-translations.json
 * 用于 AI prompt 术语匹配与中文知识注入
 */
import fs from 'fs'
import path from 'path'

/** 词条配置（来自 config.json） */
interface EntryConfig {
  id: string
  terms: string[]
  summary: string
  updatedAt: number
}

/** 中译词条 */
interface ZhEntry {
  id: string
  terms: string[]
  termsZh: string
  definitionZh: string
}

/** 对外暴露的词条数据结构 */
export interface DictionaryEntry {
  id: string
  terms: string[]
  termsZh: string
  definitionZh: string
}

/** 缓存 */
let entryConfigs: EntryConfig[] | null = null
let zhEntries: ZhEntry[] | null = null

/** 路径常量 */
const CONFIG_PATH = path.join('public', 'database', 'dictionary', 'config.json')
const ZH_PATH = path.join('public', 'database', 'dictionary', 'zh-translations.json')

/**
 * 加载 config.json 词条索引
 */
function loadConfig(): EntryConfig[] {
  if (entryConfigs) {
    return entryConfigs
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const data = JSON.parse(raw) as { entries: EntryConfig[] }
    entryConfigs = data.entries || []
    return entryConfigs
  } catch {
    console.warn('[Dictionary] 未找到 config.json，知识库将为空')
    return []
  }
}

/**
 * 加载中文翻译词条
 */
function loadZhEntries(): ZhEntry[] {
  if (zhEntries) {
    return zhEntries
  }
  try {
    const raw = fs.readFileSync(ZH_PATH, 'utf-8')
    const data = JSON.parse(raw) as { entries: ZhEntry[] }
    zhEntries = data.entries || []
    return zhEntries
  } catch {
    console.warn('[Dictionary] 未找到 zh-translations.json，将使用英文原文')
    return []
  }
}

/**
 * 根据用户输入匹配字典中的术语（支持中英文）
 * @param userInput 用户提问原文
 * @returns 匹配到的词条（含中文定义）
 */
export function matchDictionaryTerms(userInput: string): DictionaryEntry[] {
  const configs = loadConfig()
  const zhList = loadZhEntries()
  if (configs.length === 0) {
    return []
  }

  // 构建 id -> ZhEntry 索引
  const zhMap: Map<string, ZhEntry> = new Map()
  for (const zh of zhList) {
    zhMap.set(zh.id, zh)
  }

  const lowerInput = userInput.toLowerCase()
  const matched: Map<string, DictionaryEntry> = new Map()

  for (const config of configs) {
    // 匹配英文 terms
    let hit = config.terms.some((term) =>
      lowerInput.includes(term.toLowerCase())
    )

    // 也匹配中文术语（如果有的话）
    const zh = zhMap.get(config.id)
    if (!hit && zh) {
      hit = lowerInput.includes(zh.termsZh.toLowerCase()) ||
        zh.terms.some((t) => lowerInput.includes(t.toLowerCase()))
    }

    if (!hit) {
      continue
    }
    if (matched.has(config.id)) {
      continue
    }

    matched.set(config.id, {
      id: config.id,
      terms: config.terms,
      termsZh: zh ? zh.termsZh : config.terms[0],
      definitionZh: zh
        ? zh.definitionZh
        : config.summary
    })
  }

  return Array.from(matched.values())
}

/**
 * 获取所有中文词典条目（不含匹配逻辑）
 */
export function getAllZhEntries(): Array<{ label: string; text: string }> {
  const zhList = loadZhEntries()
  return zhList.map((z) => ({
    label: z.termsZh || z.terms[0],
    text: z.definitionZh
  }))
}

/** 所有词条摘要缓存 */
let allSummariesCache: string | null = null

/**
 * 获取所有词条的中文简介
 * 格式：「术语(中文名): 简要说明」
 * 用于 AI 系统提示词注入
 */
export function getAllTermSummaries(): string {
  if (allSummariesCache) {
    return allSummariesCache
  }

  const zhList = loadZhEntries()
  if (zhList.length === 0) {
    return ''
  }

  const lines = zhList.map((z) => {
    const enTerms = z.terms.join(' / ')
    const summary =
      z.definitionZh.length > 120
        ? z.definitionZh.slice(0, 117) + '...'
        : z.definitionZh
    return `- ${z.termsZh} (${enTerms}): ${summary}`
  })

  allSummariesCache = `## 存储技术词典 (Storage Tech Dictionary)\n${lines.join('\n')}`
  return allSummariesCache
}
