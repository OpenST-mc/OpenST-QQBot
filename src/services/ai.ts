/**
 * DeepSeek AI 服务层
 * 业务逻辑通过本层调用 AI，不直接访问 DeepSeek API
 * 负责：prompt 构建、对话请求、响应解析、多轮上下文管理
 */
import axios from 'axios'
import {
  DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_MODEL,
  SHARE_BASE_URL
} from '../config'
import { ContextMessage } from './context'
import { MachineEntry } from './data'

/** AI 服务返回结构 */
export interface AiResponse {
  answer: string
  /** 推荐的机器 sub_id 列表（已通过数据库验证） */
  recommendations: string[]
}

/** 消息格式（兼容 DeepSeek API） */
interface ApiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * 单次 AI 问答（带可选上下文）
 */
export async function askAi(
  systemPrompt: string,
  userPrompt: string,
  history?: ContextMessage[]
): Promise<string> {
  const messages: ApiMessage[] = [{ role: 'system', content: systemPrompt }]

  // 注入历史对话
  if (history && history.length > 0) {
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content })
    }
  }

  // 当前用户问题
  messages.push({ role: 'user', content: userPrompt })

  const resp = await axios.post(
    `${DEEPSEEK_BASE_URL}/chat/completions`,
    {
      model: DEEPSEEK_MODEL,
      messages: messages,
      temperature: 0.3,
      max_tokens: 2000
    },
    {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  )

  const choice = (resp.data as Record<string, unknown>)
    ['choices'] as Array<Record<string, unknown>>
  const message = choice[0]?.['message'] as Record<string, unknown> | undefined
  return String(message?.['content'] || '')
}

/**
 * 构建机器列表提示（紧凑格式：name + 作者 + 标签 + 链接）
 */
function buildMachinePrompt(machines: MachineEntry[]): string {
  return machines
    .map(
      (m, i) => {
        const tagsStr = m.tags.length > 0 ? m.tags.join(', ') : '无标签'
        return `${i + 1}. ${m.name}\n` +
          `   作者: ${m.author} | 标签: ${tagsStr}\n` +
          `   链接: ${SHARE_BASE_URL}${m.subId}`
      }
    )
    .join('\n')
}

/**
 * 带机器推荐的 AI 问答
 * 将数据库中的机器列表（含作者、标签）注入 prompt，AI 从中选取推荐
 * AI 回复后从答案中匹配实际的 sub_id，确保链接正确
 * @param systemPrompt 系统提示词
 * @param userPrompt 用户问题
 * @param allMachines 数据库中所有机器
 * @param matchedMachines 根据查询关键词匹配到的候选机器（含描述）
 * @param history 该用户的历史对话（可选）
 */
export async function askAiWithRecommendations(
  systemPrompt: string,
  userPrompt: string,
  allMachines: MachineEntry[],
  matchedMachines: MachineEntry[],
  history?: ContextMessage[]
): Promise<AiResponse> {
  // 系统提示：全量机器列表（紧凑格式，不含 description）
  const machineDesc = buildMachinePrompt(allMachines)

  let fullPrompt = `${systemPrompt}

## 可用机器列表（含链接）
${machineDesc}

## 输出要求
在回答中，如果用户问到机器推荐问题，请列出推荐的机器名称和对应的链接。
直接从上面的机器列表中选择，不要编造链接。`

  // 用户提示：附上 AI 根据查询关键词匹配到的候选机器详情
  let enrichedUserPrompt = userPrompt
  if (matchedMachines.length > 0) {
    const candidateDesc = matchedMachines
      .map((m) => {
        const tagsStr = m.tags.join(', ')
        const desc = m.description
          // 去除 markdown 标记以便 AI 阅读
          .replace(/### /g, '')
          .replace(/\*\*/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
        return `---\n` +
          `名称: ${m.name}\n` +
          `作者: ${m.author}\n` +
          `标签: ${tagsStr}\n` +
          `简介:\n${desc}`
      })
      .join('\n')

    enrichedUserPrompt =
      `用户问题: ${userPrompt}\n\n` +
      `以下是与你问题匹配度最高的机器详细信息，请优先从中推荐:\n${candidateDesc}`
  }

  const answer = await askAi(fullPrompt, enrichedUserPrompt, history)

  // 验证 sub_id
  const validSubIds = new Set(allMachines.map((m) => m.subId))
  const nameToSubId = new Map<string, string>()
  for (const m of allMachines) {
    nameToSubId.set(m.name, m.subId)
  }

  const recommendedSubIds: string[] = []

  // 从 AI 回答中提取链接里的 sub_id
  const linkRegex = /\/api\/share\?(sub-[\w-]+)/g
  let linkMatch: RegExpExecArray | null
  while ((linkMatch = linkRegex.exec(answer)) !== null) {
    const subId = linkMatch[1]
    if (validSubIds.has(subId) && !recommendedSubIds.includes(subId)) {
      recommendedSubIds.push(subId)
    }
  }

  // 回退：通过机器名匹配
  if (recommendedSubIds.length === 0) {
    for (const [name, subId] of nameToSubId) {
      if (answer.includes(name) && !recommendedSubIds.includes(subId)) {
        recommendedSubIds.push(subId)
        if (recommendedSubIds.length >= 3) {
          break
        }
      }
    }
  }

  return { answer, recommendations: recommendedSubIds }
}
