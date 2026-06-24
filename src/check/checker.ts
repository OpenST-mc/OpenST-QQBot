/**
 * 静态代码审查引擎
 * 仅执行静态分析，不修改代码、不重构
 * 覆盖：注释规则、并发/健壮性、代码风格
 * 输出：根目录 check.md
 */
import fs from 'fs'
import path from 'path'

/** 分析目标目录 */
const SCAN_DIRS = ['src']
/** 分析的文件扩展名 */
const SCAN_EXTENSIONS = ['.ts', '.js']

/** 单条审查结果 */
interface Issue {
  filePath: string
  line: number
  severity: 'Critical' | 'Warning' | 'Style'
  description: string
  suggestion: string
}

/** 整份审查报告 */
interface CheckReport {
  critical: Issue[]
  warning: Issue[]
  style: Issue[]
}

/**
 * 递归获取目录下所有 scannable 文件
 */
function collectFiles(rootDir: string, dirs: string[]): string[] {
  const result: string[] = []
  for (const dir of dirs) {
    const fullDir = path.join(rootDir, dir)
    if (!fs.existsSync(fullDir)) {
      continue
    }
    const entries = fs.readdirSync(fullDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(fullDir, entry.name)
      if (entry.isDirectory()) {
        result.push(...collectFiles(rootDir, [path.join(dir, entry.name)]))
      } else if (SCAN_EXTENSIONS.includes(path.extname(entry.name))) {
        result.push(fullPath)
      }
    }
  }
  return result
}

/**
 * 读取文件所有行
 */
function readLines(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  return content.split(/\r?\n/)
}

/**
 * 收集文件中的所有注释行及起止位置
 */
function findComments(lines: string[]): Array<{
  lineNum: number
  text: string
  isBlock: boolean
}> {
  const comments: Array<{ lineNum: number; text: string; isBlock: boolean }> = []
  let inBlockComment = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 处理块注释
    if (inBlockComment) {
      const endIdx = line.indexOf('*/')
      if (endIdx !== -1) {
        comments.push({
          lineNum: i + 1,
          text: line.substring(0, endIdx).trim(),
          isBlock: true
        })
        inBlockComment = false
      } else {
        comments.push({
          lineNum: i + 1,
          text: line.trim(),
          isBlock: true
        })
      }
      continue
    }

    // 检查块注释开始
    const startIdx = line.indexOf('/*')
    if (startIdx !== -1) {
      const endIdx = line.indexOf('*/', startIdx + 2)
      if (endIdx !== -1) {
        comments.push({
          lineNum: i + 1,
          text: line.substring(startIdx + 2, endIdx).trim(),
          isBlock: true
        })
      } else {
        comments.push({
          lineNum: i + 1,
          text: line.substring(startIdx + 2).trim(),
          isBlock: true
        })
        inBlockComment = true
      }
      // 检查该行是否还有行注释
      const lineCommentIdx = line.indexOf('//')
      if (lineCommentIdx !== -1 && (lineCommentIdx < startIdx || lineCommentIdx > endIdx)) {
        // 可能有混合，先跳过
      }
      continue
    }

    // 检查行注释
    const lineCommentIdx = line.indexOf('//')
    if (lineCommentIdx !== -1) {
      // 确保不在字符串中（简单启发式）
      const beforeComment = line.substring(0, lineCommentIdx)
      const quoteCount = (beforeComment.match(/"/g) || []).length
      if (quoteCount % 2 === 0) {
        comments.push({
          lineNum: i + 1,
          text: line.substring(lineCommentIdx + 2).trim(),
          isBlock: false
        })
      }
    }
  }
  return comments
}

/**
 * 检查注释规则
 */
function checkComments(
  filePath: string,
  lines: string[]
): Issue[] {
  const issues: Issue[] = []
  const comments = findComments(lines)

  for (const comment of comments) {
    const commentText = comment.text
    if (!commentText) {
      continue
    }

    // 检查是否包含 emoji
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/u
    if (emojiRegex.test(commentText)) {
      issues.push({
        filePath,
        line: comment.lineNum,
        severity: 'Style',
        description: '注释中包含 emoji',
        suggestion: '移除 emoji，使用纯中文描述'
      })
    }

    // 检查是否包含中文
    const hasChinese = /[\u4e00-\u9fa5]/.test(commentText)
    if (!hasChinese && commentText.length > 10) {
      issues.push({
        filePath,
        line: comment.lineNum,
        severity: 'Style',
        description: '非中文注释（代码注释应使用中文）',
        suggestion: '将注释改写为中文'
      })
    }

    // 检查是否仅重复代码逻辑（简单启发：注释与相邻代码行高度相似）
    const nextLineIdx = comment.lineNum // 0-indexed
    if (nextLineIdx < lines.length) {
      const nextLine = lines[nextLineIdx].trim()
      const commentWords = commentText
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
        .toLowerCase()
      const nextLineWords = nextLine
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
        .toLowerCase()
      // 如果注释只是把英文翻译成中文且无新增信息 -> warning
      if (
        commentWords.length > 0 &&
        nextLineWords.length > 0 &&
        !hasChinese &&
        commentWords === nextLineWords
      ) {
        issues.push({
          filePath,
          line: comment.lineNum,
          severity: 'Warning',
          description: '注释重复代码逻辑，应解释"为什么"',
          suggestion: '注释应说明设计意图或为什么这样做，而非复述代码'
        })
      }
    }
  }

  return issues
}

/**
 * 检查并发与健壮性问题
 */
function checkConcurrency(
  filePath: string,
  lines: string[]
): Issue[] {
  const issues: Issue[] = []
  const content = lines.join('\n')

  // 检查全局可变状态
  const globalMutablePattern = /^(let|var)\s+\w+\s*[=;]/gm
  let gMatch: RegExpExecArray | null
  while ((gMatch = globalMutablePattern.exec(content)) !== null) {
    // 排除函数内部的 let/var
    const beforeMatch = content.substring(0, gMatch.index)
    const openBraces = (beforeMatch.match(/{/g) || []).length
    const closeBraces = (beforeMatch.match(/}/g) || []).length
    if (openBraces - closeBraces <= 0) {
      const lineNum = content.substring(0, gMatch.index).split('\n').length
      issues.push({
        filePath,
        line: lineNum,
        severity: 'Warning',
        description: '全局可变状态可能导致并发问题',
        suggestion: '考虑将状态封装在模块内或使用闭包限制作用域'
      })
    }
  }

  // 检查异步操作中没有错误处理
  const linesForCheck = lines
  for (let i = 0; i < linesForCheck.length; i++) {
    const line = linesForCheck[i].trim()
    // 检查 await 后没有 try-catch 包裹的情况（简化版）
    if (line.includes('await ') && !line.includes('try {') && !line.includes('.catch(')) {
      // 查找最近的外层 try-catch
      let hasTryCatch = false
      for (let j = Math.max(0, i - 20); j < i; j++) {
        if (linesForCheck[j].trim() === 'try {') {
          hasTryCatch = true
          break
        }
      }
      if (!hasTryCatch) {
        // 检查是赋值还是单独调用
        if (line.startsWith('await ')) {
          issues.push({
            filePath,
            line: i + 1,
            severity: 'Warning',
            description: '未捕获的异步操作可能静默失败',
            suggestion: '使用 try-catch 或 .catch() 处理异步错误'
          })
        }
      }
    }
  }

  return issues
}

/**
 * 检查代码风格
 */
function checkStyle(
  filePath: string,
  lines: string[]
): Issue[] {
  const issues: Issue[] = []

  // 检查文件行数
  if (lines.length > 800) {
    issues.push({
      filePath,
      line: 1,
      severity: 'Style',
      description: `文件行数 ${lines.length} 超过 800 行限制`,
      suggestion: '将文件拆分为多个模块，每个文件不超过 800 行'
    })
  }

  // 检查缩进一致性
  const indentSizes: number[] = []
  for (const line of lines) {
    const trimmed = line.trimStart()
    if (trimmed && trimmed !== line) {
      const indent = line.length - trimmed.length
      if (indent > 0 && indent <= 8) {
        indentSizes.push(indent)
      }
    }
  }
  const mostCommonIndent = mode(indentSizes)
  if (mostCommonIndent !== 2) {
    issues.push({
      filePath,
      line: 1,
      severity: 'Style',
      description: `缩进为 ${mostCommonIndent} 空格，应统一为 2 空格`,
      suggestion: '统一使用 2 空格缩进'
    })
  }

  // 逐行检查
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 跳过空行和非代码行
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) {
      continue
    }

    // 检查行长度
    if (line.length > 100) {
      issues.push({
        filePath,
        line: i + 1,
        severity: 'Style',
        description: `行长度 ${line.length} 超过 100 字符限制`,
        suggestion: '拆分为多行'
      })
    }

    // 检查运算符两侧空格
    const operatorPatterns = [
      { regex: /[^=!<>]=[^=]/g, name: '=' },
      { regex: /[^=]=[^=]/g, name: '==' },
      { regex: /[^+\-*/%&|^<>]= /g, name: '复合赋值' },
      { regex: /\S\+\S/g, name: '+' },
      { regex: /\S\-\S/g, name: '-' }
    ]
    for (const { regex, name } of operatorPatterns) {
      if (regex.test(trimmed)) {
        issues.push({
          filePath,
          line: i + 1,
          severity: 'Style',
          description: `运算符 "${name}" 未加空格`,
          suggestion: '运算符两侧各加一个空格'
        })
        break // 每行只报一次
      }
    }

    // 检查驼峰命名（变量声明）
    const varDeclMatch = trimmed.match(
      /(?:const|let|var)\s+(\w+)/
    )
    if (varDeclMatch) {
      const varName = varDeclMatch[1]
      // 允许全大写常量
      if (varName !== varName.toUpperCase() && !isCamelCase(varName)) {
        issues.push({
          filePath,
          line: i + 1,
          severity: 'Style',
          description: `变量名 "${varName}" 不是驼峰命名`,
          suggestion: '使用驼峰命名法如: myVariableName'
        })
      }
    }

    // 检查函数命名
    const funcDeclMatch = trimmed.match(
      /function\s+(\w+)/
    )
    if (funcDeclMatch && !isCamelCase(funcDeclMatch[1])) {
      issues.push({
        filePath,
        line: i + 1,
        severity: 'Style',
        description: `函数名 "${funcDeclMatch[1]}" 不是驼峰命名`,
        suggestion: '使用驼峰命名法如: myFunctionName'
      })
    }
  }

  // 检查逻辑块之间是否有空行分隔
  let consecutiveNonEmpty = 0
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed === '' || trimmed.startsWith('//')) {
      consecutiveNonEmpty = 0
    } else {
      consecutiveNonEmpty++
      if (consecutiveNonEmpty > 50) {
        issues.push({
          filePath,
          line: i + 1,
          severity: 'Style',
          description: '逻辑块之间缺少空行分隔',
          suggestion: '在逻辑块之间添加空行以提高可读性'
        })
        break
      }
    }
  }

  return issues
}

/** 检查是否为驼峰命名 */
function isCamelCase(name: string): boolean {
  return /^[a-z][a-zA-Z0-9]*$/.test(name)
}

/** 计算数组众数 */
function mode(arr: number[]): number {
  if (arr.length === 0) return 2
  const counts = new Map<number, number>()
  for (const val of arr) {
    counts.set(val, (counts.get(val) || 0) + 1)
  }
  let maxCount = 0
  let maxVal = arr[0]
  for (const [val, count] of counts) {
    if (count > maxCount) {
      maxCount = count
      maxVal = val
    }
  }
  return maxVal
}

/**
 * 生成 Markdown 报告
 */
function generateReport(report: CheckReport): string {
  const lines: string[] = []
  lines.push('# 静态代码审查报告')
  lines.push('')
  lines.push(`> 生成时间: ${new Date().toISOString()}`)
  lines.push('')

  // Critical
  lines.push('## Critical（必须修复）')
  lines.push('')
  if (report.critical.length === 0) {
    lines.push('未发现 Critical 问题。')
    lines.push('')
  } else {
    for (const issue of report.critical) {
      lines.push(`### ${issue.filePath}:${issue.line}`)
      lines.push(`- **问题**: ${issue.description}`)
      lines.push(`- **建议**: ${issue.suggestion}`)
      lines.push('')
    }
  }

  // Warning
  lines.push('## Warning（可能风险）')
  lines.push('')
  if (report.warning.length === 0) {
    lines.push('未发现 Warning 问题。')
    lines.push('')
  } else {
    for (const issue of report.warning) {
      lines.push(`### ${issue.filePath}:${issue.line}`)
      lines.push(`- **问题**: ${issue.description}`)
      lines.push(`- **建议**: ${issue.suggestion}`)
      lines.push('')
    }
  }

  // Style
  lines.push('## Style（风格问题）')
  lines.push('')
  if (report.style.length === 0) {
    lines.push('未发现 Style 问题。')
    lines.push('')
  } else {
    for (const issue of report.style) {
      lines.push(`### ${issue.filePath}:${issue.line}`)
      lines.push(`- **问题**: ${issue.description}`)
      lines.push(`- **建议**: ${issue.suggestion}`)
      lines.push('')
    }
  }

  return lines.join('\n')
}

/**
 * 执行完整审查并写入 check.md
 */
export async function runChecker(projectRoot: string): Promise<string> {
  const report: CheckReport = {
    critical: [],
    warning: [],
    style: []
  }

  const files = collectFiles(projectRoot, SCAN_DIRS)

  for (const file of files) {
    const lines = readLines(file)
    const relativePath = path.relative(projectRoot, file).replace(/\\/g, '/')

    // 执行各项检查
    const commentIssues = checkComments(relativePath, lines)
    const concurrencyIssues = checkConcurrency(relativePath, lines)
    const styleIssues = checkStyle(relativePath, lines)

    for (const issue of commentIssues) {
      if (issue.severity === 'Critical') report.critical.push(issue)
      else if (issue.severity === 'Warning') report.warning.push(issue)
      else report.style.push(issue)
    }
    for (const issue of concurrencyIssues) {
      if (issue.severity === 'Critical') report.critical.push(issue)
      else if (issue.severity === 'Warning') report.warning.push(issue)
      else report.style.push(issue)
    }
    for (const issue of styleIssues) {
      if (issue.severity === 'Critical') report.critical.push(issue)
      else if (issue.severity === 'Warning') report.warning.push(issue)
      else report.style.push(issue)
    }
  }

  const reportText = generateReport(report)
  const outputPath = path.join(projectRoot, 'check.md')
  fs.writeFileSync(outputPath, reportText, 'utf-8')

  // 返回摘要信息
  const summary =
    `审查完成。\n` +
    `分析文件: ${files.length} 个\n` +
    `Critical: ${report.critical.length}\n` +
    `Warning: ${report.warning.length}\n` +
    `Style: ${report.style.length}\n` +
    `详细报告见 check.md`

  return summary
}
