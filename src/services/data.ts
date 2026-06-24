/**
 * 数据服务层
 * 负责：CSV 词汇表解析、本地 JSON 数据库读取
 * 不包含业务逻辑，仅做数据读取与格式转换
 */
import fs from 'fs'
import { parse } from 'csv-parse/sync'
import { GLOSSARY_CSV_PATH, DATABASE_PATH } from '../config'

/** 词汇表条目 */
export interface GlossaryEntry {
  term: string
  definition: string
}

/** 机器数据条目 */
export interface MachineEntry {
  name: string
  subId: string
  author: string
  tags: string[]
  description: string
}

/**
 * 从 CSV 文件加载术语词汇表
 * 期望表头：term, definition
 */
export function loadGlossary(): GlossaryEntry[] {
  const raw = fs.readFileSync(GLOSSARY_CSV_PATH, 'utf-8')
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true
  }) as Array<Record<string, string>>

  return records.map((row) => ({
    term: String(row['term'] || row['术语'] || ''),
    definition: String(row['definition'] || row['定义'] || '')
  }))
}

/**
 * 在词汇表中模糊匹配用户输入中出现的术语
 * @param userInput 用户输入文本
 * @param glossary 词汇表
 * @returns 匹配到的术语条目列表
 */
export function matchGlossaryTerms(
  userInput: string,
  glossary: GlossaryEntry[]
): GlossaryEntry[] {
  const matched: GlossaryEntry[] = []
  const usedTerms = new Set<string>()
  // 优先匹配长术语，避免短术语误匹配
  const sorted = [...glossary].sort((a, b) => b.term.length - a.term.length)

  for (const entry of sorted) {
    if (usedTerms.has(entry.term)) {
      continue
    }
    if (userInput.toLowerCase().includes(entry.term.toLowerCase())) {
      matched.push(entry)
      usedTerms.add(entry.term)
    }
  }
  return matched
}

/**
 * 从本地文件读取机器数据库 JSON
 * 数据库格式：[{ id, name, author, tags: [...], description: "...", sub_id: "..." }]
 * 注意：此文件只读，不允许修改
 */
export function loadMachineDatabase(): MachineEntry[] {
  const raw = fs.readFileSync(DATABASE_PATH, 'utf-8')
  const data = JSON.parse(raw) as Array<{
    name: string
    sub_id: string
    author: string
    tags: string[]
    description: string
  }>

  return data.map((m) => ({
    name: m.name,
    subId: String(m.sub_id || ''),
    author: m.author || 'Unknown',
    tags: Array.isArray(m.tags) ? m.tags : [],
    description: m.description || ''
  }))
}

/**
 * 根据用户输入中的关键词匹配机器
 * 匹配范围：name、tags、author
 * @param userInput 用户提问
 * @param machines 数据库中所有机器
 * @returns 匹配到的机器列表（按匹配度排序，最多返回 5 台）
 */
export function searchMachines(
  userInput: string,
  machines: MachineEntry[]
): MachineEntry[] {
  const lowerInput = userInput.toLowerCase()
  const scored: Array<{ entry: MachineEntry; score: number }> = []

  for (const m of machines) {
    let score = 0

    // name 匹配（权重最高）
    if (lowerInput.includes(m.name.toLowerCase())) {
      score += 10
    } else {
      // 名称的部分匹配
      for (const word of m.name.split(/[\s\-【】\[\]（）\(\)]+/)) {
        if (word.length > 1 && lowerInput.includes(word.toLowerCase())) {
          score += 3
        }
      }
    }

    // tags 匹配
    for (const tag of m.tags) {
      if (lowerInput.includes(tag.toLowerCase())) {
        score += 5
      }
    }

    // author 匹配
    if (m.author !== 'Unknown' && lowerInput.includes(m.author.toLowerCase())) {
      score += 2
    }

    if (score > 0) {
      scored.push({ entry: m, score })
    }
  }

  // 按分数降序，取前 5
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 5).map((s) => s.entry)
}
