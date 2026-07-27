// 知识系统枚举与状态机
// 本文件是审核状态、公开性、可信度、候选状态、质量旗标、AI 任务与回答判定的唯一真源
// 业务代码与 schema 一律引用此处常量，禁止在各表定义或写入路径散落字符串字面值

// 审核状态
// legacy_review 专用于缺少逐笔来源与版本信息的历史数据，不等同于 pending
export const REVIEW_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'deprecated',
  'disputed',
  'legacy_review'
] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

// 公开性
// internal 表示仅审核者可见；public 表示可在一般回答中引用并对外署名
export const VISIBILITIES = ['internal', 'public'] as const
export type Visibility = (typeof VISIBILITIES)[number]

// 可信度
// 描述结论的证据强度，与审核状态正交：approved 的内容仍可能只是 inferred
export const CONFIDENCE_LEVELS = [
  'documented',
  'expert_reviewed',
  'measured',
  'inferred',
  'unverified'
] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

// 候选状态
// AI 抽取产物的生命周期，与人工审核状态分开，候选本身不进入 Answer Index
export const CANDIDATE_STATUSES = [
  'generated',
  'materialized',
  'rejected',
  'superseded'
] as const
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number]

// 质量旗标
export const QUALITY_FLAGS = [
  'empty',
  'stub',
  'navigation',
  'not_found',
  'broken_link',
  'duplicate_exact',
  'duplicate_near',
  'mixed_concepts',
  'possible_typo',
  'conflicting_fact',
  'license_unknown'
] as const
export type QualityFlag = (typeof QUALITY_FLAGS)[number]

// 阻挡 materialize 的质量旗标
// 命中任一项的候选只能停留在候选区，不得自动建立 pending 项目
export const BLOCKING_QUALITY_FLAGS: readonly QualityFlag[] = [
  'empty',
  'stub',
  'navigation',
  'not_found',
  'duplicate_exact',
  'mixed_concepts',
  'possible_typo',
  'conflicting_fact'
]

// AI 任务类型
export const AI_TASK_TYPES = [
  'document_triage',
  'document_quality',
  'term_normalize',
  'claim_extract',
  'query_plan',
  'answer_split',
  'feedback_classify',
  'conflict_review',
  'answer_synthesis'
] as const
export type AiTaskType = (typeof AI_TASK_TYPES)[number]

// 回答判定
// partial 必须拆分知识点逐项判定；amend 建立待审修订候选
export const ANSWER_VERDICTS = ['correct', 'incorrect', 'partial', 'amend'] as const
export type AnswerVerdict = (typeof ANSWER_VERDICTS)[number]

// 枚举值非法时抛出，携带字段名与合法值以便直接回报给审核者
export class EnumValueError extends Error {
  constructor(
    public readonly field: string,
    public readonly value: unknown,
    public readonly allowed: readonly string[]
  ) {
    super(
      `${field} 的值不合法: ${JSON.stringify(value)}；` +
        `合法值为 ${allowed.join(', ')}`
    )
    this.name = 'EnumValueError'
  }
}

// 建立类型守卫，供 AI JSON、外部输入与 DB 读取的运行期校验使用
function createGuard<T extends string>(values: readonly T[]) {
  return (value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value)
}

// 建立断言函数，非法值抛出 EnumValueError
function createAssert<T extends string>(field: string, values: readonly T[]) {
  const guard = createGuard(values)
  return (value: unknown): T => {
    if (!guard(value)) {
      throw new EnumValueError(field, value, values)
    }
    return value
  }
}

export const isReviewStatus = createGuard(REVIEW_STATUSES)
export const isVisibility = createGuard(VISIBILITIES)
export const isConfidenceLevel = createGuard(CONFIDENCE_LEVELS)
export const isCandidateStatus = createGuard(CANDIDATE_STATUSES)
export const isQualityFlag = createGuard(QUALITY_FLAGS)
export const isAiTaskType = createGuard(AI_TASK_TYPES)
export const isAnswerVerdict = createGuard(ANSWER_VERDICTS)

export const assertReviewStatus = createAssert('review_status', REVIEW_STATUSES)
export const assertVisibility = createAssert('visibility', VISIBILITIES)
export const assertConfidenceLevel = createAssert('confidence_level', CONFIDENCE_LEVELS)
export const assertCandidateStatus = createAssert('candidate_status', CANDIDATE_STATUSES)
export const assertQualityFlag = createAssert('quality_flag', QUALITY_FLAGS)
export const assertAiTaskType = createAssert('ai_task_type', AI_TASK_TYPES)
export const assertAnswerVerdict = createAssert('answer_verdict', ANSWER_VERDICTS)

// 状态转移操作者
// reviewer 代表已通过知识审核白名单校验的人工操作；system 代表导入器、AI 与后台作业
export const TRANSITION_ACTORS = ['reviewer', 'system'] as const
export type TransitionActor = (typeof TRANSITION_ACTORS)[number]
export const isTransitionActor = createGuard(TRANSITION_ACTORS)

// 审核状态转移表
// pending、approved、legacy_review 三条规则来自规划书；disputed 与 deprecated 的出向
// 转移规划书未定义，此处采用最保守解读：争议可由审核者裁决，废弃为终态
export const REVIEW_STATUS_TRANSITIONS: Readonly<
  Record<ReviewStatus, readonly ReviewStatus[]>
> = {
  pending: ['approved', 'rejected', 'deprecated', 'disputed'],
  approved: ['deprecated', 'disputed'],
  // 被拒内容不得直接复活，必须另建候选或明确修订记录后重新走 pending
  rejected: [],
  // 废弃为终态，取代它的应是新条目而非原地改写
  deprecated: [],
  disputed: ['approved', 'rejected', 'deprecated'],
  legacy_review: ['approved', 'rejected', 'deprecated']
}

// 出向转移一律需要人工审核者的来源状态
const REVIEWER_ONLY_FROM: readonly ReviewStatus[] = ['legacy_review']

// 只能由人工审核者写入的目标状态
// 对应核心原则：AI 抽取、自动学习与导入产物都不得自行升格为已核准
const REVIEWER_ONLY_TO: readonly ReviewStatus[] = ['approved']

// 建立时的合法初始状态
// 注意这是建立而非转移，导入器可依来源政策直接建立 approved 的机器目录资料，
// 但任何已存在资料要变成 approved 都必须走 assertReviewStatusTransition
export const INITIAL_REVIEW_STATUSES: readonly ReviewStatus[] = [
  'pending',
  'legacy_review',
  'approved'
]

// 状态转移非法时抛出，消息需可直接呈现给审核者
export class StatusTransitionError extends Error {
  constructor(
    public readonly from: ReviewStatus,
    public readonly to: ReviewStatus,
    public readonly actor: TransitionActor,
    reason: string
  ) {
    super(`审核状态不可由 ${from} 转为 ${to}（操作者 ${actor}）: ${reason}`)
    this.name = 'StatusTransitionError'
  }
}

// 检查状态转移是否合法，返回不合法原因；合法时返回 null
export function checkReviewStatusTransition(
  from: ReviewStatus,
  to: ReviewStatus,
  actor: TransitionActor
): string | null {
  if (from === to) {
    return '来源与目标状态相同，无需转移'
  }

  const allowed = REVIEW_STATUS_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    if (allowed.length === 0) {
      return `${from} 为终态，如需恢复必须另建候选或明确修订记录`
    }
    return `合法目标状态为 ${allowed.join(', ')}`
  }

  if (actor !== 'reviewer' && REVIEWER_ONLY_TO.includes(to)) {
    return `转为 ${to} 只能由人工审核者执行，导入器与 AI 只能产生候选或待审内容`
  }

  if (actor !== 'reviewer' && REVIEWER_ONLY_FROM.includes(from)) {
    return `${from} 的内容只能由人工审核者转移`
  }

  return null
}

// 布尔版本的转移检查，供查询与界面显示使用
export function canTransitionReviewStatus(
  from: ReviewStatus,
  to: ReviewStatus,
  actor: TransitionActor
): boolean {
  return checkReviewStatusTransition(from, to, actor) === null
}

// 断言状态转移合法
// 调用方必须在写入 DB 之前调用，抛出时不得留下任何部分写入
export function assertReviewStatusTransition(
  from: ReviewStatus,
  to: ReviewStatus,
  actor: TransitionActor
): void {
  const reason = checkReviewStatusTransition(from, to, actor)
  if (reason !== null) {
    throw new StatusTransitionError(from, to, actor, reason)
  }
}
