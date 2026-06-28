/**
 * Sentence-BERT 语义搜索服务
 * 使用 @xenova/transformers 在 Node.js 本地运行，无需 Python
 * 模型：paraphrase-multilingual-MiniLM-L12-v2（支持中文，~470MB）
 * 用途：对术语表、词典、社区知识库做语义匹配，不负责机器搜索
 */
const MODEL_NAME = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'

/** 统一知识条目格式 */
export interface KnowledgeEntry {
  source: 'glossary' | 'dictionary' | 'learned'
  label: string
  text: string
}

/** 特征提取管线实例（单例） */
let extractor: any = null

async function getExtractor(): Promise<any> {
  if (extractor) return extractor
  console.log(`[Embedding] 正在加载模型 ${MODEL_NAME}（首次需下载 ~470MB）...`)
  const { pipeline } = await import('@xenova/transformers')
  extractor = await pipeline('feature-extraction', MODEL_NAME)
  console.log('[Embedding] 模型加载完成')
  return extractor
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

async function computeEmbedding(text: string): Promise<number[]> {
  const model = await getExtractor()
  const output = await model(text, { pooling: 'mean', normalize: true })
  return Array.from(output.data) as number[]
}

/** 知识库 embedding 缓存 */
let knowledgeEmbeddings: Array<{
  entry: KnowledgeEntry
  embedding: number[]
}> | null = null

/**
 * 预热模型：启动时调用，提前下载并加载模型
 */
export async function warmupEmbedding(): Promise<void> {
  try {
    await getExtractor()
    console.log('[Embedding] 预热完成')
  } catch (err) {
    const error = err as Error
    console.warn('[Embedding] 模型加载失败，将回退关键词匹配:', error.message)
  }
}

/**
 * 构建知识库语义索引
 * 将所有知识条目编码为向量并缓存
 */
export async function buildKnowledgeIndex(entries: KnowledgeEntry[]): Promise<void> {
  const model = await getExtractor()
  const results: Array<{ entry: KnowledgeEntry; embedding: number[] }> = []
  for (const entry of entries) {
    const searchText = `${entry.label} ${entry.text}`
    const output = await model(searchText, { pooling: 'mean', normalize: true })
    results.push({ entry, embedding: Array.from(output.data) as number[] })
  }
  knowledgeEmbeddings = results
  console.log(`[Embedding] 知识库索引完成: ${results.length} 条`)
}

/**
 * 语义搜索知识库
 * @param query  用户问题
 * @param topK  返回 topK 条
 * @returns  匹配的知识条目（含分数）
 */
export async function searchKnowledge(
  query: string,
  topK: number = 5
): Promise<Array<KnowledgeEntry & { score: number }>> {
  if (!knowledgeEmbeddings) return []

  const queryEmb = await computeEmbedding(query)

  const scored = knowledgeEmbeddings.map(({ entry, embedding }) => ({
    entry,
    score: cosineSimilarity(queryEmb, embedding)
  }))
  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, topK).map((s) => ({ ...s.entry, score: s.score }))
}

/**
 * 清理缓存（用于热重载）
 */
export function clearCache(): void {
  knowledgeEmbeddings = null
}
