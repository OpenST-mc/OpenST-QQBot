// Sentence-BERT 语义搜索服务
// 使用 @xenova/transformers 在 Node.js 本地运行，无需 Python
// 模型：paraphrase-multilingual-MiniLM-L12-v2（支持中文，~470MB）
// 用途：对术语表、词典、社区知识库做语义匹配，不负责机器搜索
//
// 国内网络环境配置：
//   默认下载源为 hf-mirror.com，并自动通过本地代理(Clash 7890)下载
//   HTTPS_PROXY=http://127.0.0.1:端口   指定代理端口（默认 7890）
//   EMBEDDING_MODEL_MIRROR=https://...  覆盖下载镜像源
//   EMBEDDING_MODEL_LOCAL=./models      使用本地预下载模型（离线，优先级最高）
//     目录结构: ./models/Xenova/paraphrase-multilingual-MiniLM-L12-v2/
//     可从 https://hf-mirror.com/Xenova/paraphrase-multilingual-MiniLM-L12-v2 手动下载
const MODEL_NAME = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'

// 仅用于类型检查，编译期会被擦除，不会产生运行时 require()
type TransformersModule = typeof import('@xenova/transformers')

// @xenova/transformers 是纯 ESM 包，tsc 编译到 commonjs 时会把 await import()
// 降级为 require()，require() 无法加载纯 ESM 模块导致启动失败。
// 用 Function 构造器绕开 tsc 对动态 import() 的静态转换，运行时使用真正的
// 原生动态 import()（Node.js 在 CommonJS 文件中同样支持）
function importTransformers(): Promise<TransformersModule> {
  return new Function('return import("@xenova/transformers")')()
}

// 统一知识条目格式
export interface KnowledgeEntry {
  source: 'glossary' | 'dictionary' | 'learned'
  label: string
  text: string
}

// 特征提取管线实例（单例）
let extractor: any = null

// 模型加载 Promise，防止并发重复加载
let extractorPromise: Promise<any> | null = null

async function getExtractor(): Promise<any> {
  if (extractor) return extractor
  if (extractorPromise) return extractorPromise

  extractorPromise = (async () => {
    console.log(`[Embedding] 正在加载模型 ${MODEL_NAME}（首次需下载 ~470MB）...`)
    const { pipeline, env } = await importTransformers()

    await setupFetchProxy()

    // DNS 被本地代理(如 Clash)劫持到 127.0.0.1 且代理不可用时，切换为公共 DNS
    const dns = await import('dns')
    const servers = dns.getServers()
    if (servers.length === 1 && servers[0] === '127.0.0.1') {
      dns.setServers(['223.5.5.5', '114.114.114.114', '8.8.8.8'])
      console.log('[Embedding] 检测到本地 DNS 代理，已切换为公共 DNS')
    }

    // 优先使用本地预下载的模型
    const localPath = process.env['EMBEDDING_MODEL_LOCAL']
    if (localPath) {
      env.localModelPath = localPath
      env.allowRemoteModels = false
      console.log(`[Embedding] 使用本地模型路径: ${localPath}`)
    }

    // 镜像源：国内默认使用 hf-mirror.com，可通过环境变量覆盖
    const mirror = process.env['EMBEDDING_MODEL_MIRROR'] || 'https://hf-mirror.com/'
    env.remoteHost = mirror
    console.log(`[Embedding] 下载源: ${mirror}`)

    extractor = await pipeline('feature-extraction', MODEL_NAME)
    console.log('[Embedding] 模型加载完成')
    return extractor
  })()

  // 加载失败时重置 Promise，允许后续重试
  try {
    return await extractorPromise
  } catch (err) {
    const error = err as Error
    console.error('[Embedding] 模型加载失败:', error.message)
    extractorPromise = null
    throw err
  }
}

// 仅当用户显式配置了 HTTPS_PROXY 或 https_proxy 环境变量时，
// 才设置 undici 全局代理。避免在无代理环境下默认设置不可用代理导致
// 所有 fetch 请求失败。
async function setupFetchProxy(): Promise<void> {
  const proxyUrl = process.env['HTTPS_PROXY'] || process.env['https_proxy']
  if (!proxyUrl) {
    return
  }

  try {
    const { setGlobalDispatcher, ProxyAgent } = await import('undici')
    setGlobalDispatcher(new ProxyAgent(proxyUrl))
    console.log(`[Embedding] fetch 代理已启用: ${proxyUrl}`)
  } catch {
    // undici 未安装或代理不可用，静默回退到直连
  }
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

// 知识库 embedding 缓存
let knowledgeEmbeddings: Array<{
  entry: KnowledgeEntry
  embedding: number[]
}> | null = null

// 预热模型：启动时调用，提前下载并加载模型
export async function warmupEmbedding(): Promise<void> {
  try {
    await getExtractor()
    console.log('[Embedding] 预热完成')
  } catch (err) {
    const error = err as Error
    console.warn('[Embedding] 模型加载失败，将回退关键词匹配:', error.message)
  }
}

// 构建知识库语义索引
// 将所有知识条目编码为向量并缓存
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

// 语义搜索知识库
// @param query  用户问题
// @param topK  返回 topK 条
// @returns  匹配的知识条目（含分数）
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

// 清理缓存（用于热重载）
export function clearCache(): void {
  knowledgeEmbeddings = null
}
