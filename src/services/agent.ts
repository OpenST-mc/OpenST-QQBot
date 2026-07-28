// Agent 模型服务
// 当需要深度分析文件时，启动与主模型同型号的 DeepSeek 实例
// 接收主模型委托的任务，读取 source/ 下的文件并返回分析结果
import { askAi } from './ai'
import { SourceFile } from './source'

// Agent 系统提示词
const AGENT_SYSTEM_PROMPT =
  '你是一个文件分析助手。根据提供的文件内容，提取与用户问题相关的关键信息。\n' +
  '要求：\n' +
  '- 只分析提供给你的文件内容，不要编造信息\n' +
  '- 如果文件中找不到相关内容，直接说"未找到相关信息"\n' +
  '- 用中文回答\n' +
  '- 回答控制在 1500 字以内，重点突出'

// 启动 agent 模型分析文件
export async function analyzeSource(
  query: string,
  files: SourceFile[]
): Promise<string> {
  if (files.length === 0) return ''

  console.log(
    `[Agent] 启动文件分析 | query="${query.slice(0, 50)}" ` +
    `| files=${files.map((f) => f.path).join(', ')}`
  )

  const filesBlock = files
    .map((f) => `### 文件: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n')

  const prompt =
    `分析任务: ${query}\n\n` +
    `请从以下文件中查找相关信息:\n\n${filesBlock}`

  try {
    const result = await askAi(AGENT_SYSTEM_PROMPT, prompt, 'pro')
    console.log(`[Agent] 分析完成，输出 ${result.length} 字符`)
    return result
  } catch (err) {
    const error = err as Error & { response?: { status: number; data: unknown } }
    console.error('[Agent] 分析失败:', error.message)
    if (error.response) {
      console.error(
        `[Agent] 上游返回 ${error.response.status}:`,
        JSON.stringify(error.response.data)
      )
    }
    return ''
  }
}
