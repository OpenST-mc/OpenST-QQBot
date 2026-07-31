// scripts/lib/auditCalculations.ts 的單元測試
// 只驗證純運算函式的輸入輸出關係，不接觸檔案系統
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  sha256,
  splitLines,
  computeMachineStats,
  computeLegacyCsvStats,
  computeLegacyCsvContentHashes,
  computeLegacyMarkdownStats,
  computeDictionaryTxtStats,
  computeDictionaryEntryStats,
  computeGlossaryStats,
  hasUtf8Bom,
  detectEncoding,
  extractRelativeLinkTargets,
  linkTargetCandidates,
  normalizeLineEndings,
  classifyGtmcFile,
  diffValues
} from './auditCalculations'

describe('sha256', () => {
  it('相同內容產生相同雜湊', () => {
    assert.equal(sha256('hello'), sha256('hello'))
  })

  it('不同內容產生不同雜湊', () => {
    assert.notEqual(sha256('hello'), sha256('world'))
  })
})

describe('splitLines', () => {
  it('結尾有換行時不把結尾空字串算成一行', () => {
    assert.deepEqual(splitLines('a\nb\nc\n'), ['a', 'b', 'c'])
  })

  it('結尾沒有換行時保留最後一行', () => {
    assert.deepEqual(splitLines('a\nb\nc'), ['a', 'b', 'c'])
  })

  it('空字串視為 0 行（符合 wc -l 慣例）', () => {
    assert.deepEqual(splitLines(''), [])
  })
})

describe('computeMachineStats', () => {
  it('正常清單回傳正確統計', () => {
    const stats = computeMachineStats([
      { id: '1', name: 'A', author: 'x', tags: ['t1', 't2'], description: 'd', sub_id: 'sub-1' },
      { id: '2', name: 'B', author: 'y', tags: ['t1'], description: '', sub_id: 'sub-2' }
    ])
    assert.equal(stats.machineCount, 2)
    assert.equal(stats.uniqueSubIdCount, 2)
    assert.equal(stats.totalTagCount, 3)
    assert.equal(stats.emptyDescriptionCount, 1)
  })

  it('重複 sub_id 使唯一數小於總數', () => {
    const stats = computeMachineStats([
      { id: '1', name: 'A', author: 'x', tags: [], description: 'd', sub_id: 'sub-1' },
      { id: '2', name: 'B', author: 'y', tags: [], description: 'd', sub_id: 'sub-1' }
    ])
    assert.equal(stats.machineCount, 2)
    assert.equal(stats.uniqueSubIdCount, 1)
  })

  it('缺少 tags 欄位不拋出錯誤', () => {
    const stats = computeMachineStats([
      {
        id: '1',
        name: 'A',
        author: 'x',
        tags: undefined as unknown as string[],
        description: 'd',
        sub_id: 'sub-1'
      }
    ])
    assert.equal(stats.totalTagCount, 0)
  })
})

describe('computeLegacyCsvStats', () => {
  it('偵測空內容、多行內容與重複雜湊', () => {
    const stats = computeLegacyCsvStats([
      { topic: 'A', content: '同一內容' },
      { topic: 'A', content: '同一內容' },
      { topic: 'B', content: '' },
      { topic: 'C', content: '第一行\n第二行' }
    ])
    assert.equal(stats.logicalRecordCount, 4)
    assert.equal(stats.emptyContentCount, 1)
    assert.equal(stats.multilineRecordCount, 1)
    assert.equal(stats.duplicateContentHashCount, 1)
  })

  it('沒有重複內容時重複數為 0', () => {
    const stats = computeLegacyCsvStats([
      { topic: 'A', content: '內容一' },
      { topic: 'B', content: '內容二' }
    ])
    assert.equal(stats.duplicateContentHashCount, 0)
  })
})

describe('computeLegacyCsvContentHashes', () => {
  it('只以去除頭尾空白後的 content 雜湊，不含 topic', () => {
    const hashes = computeLegacyCsvContentHashes([
      { topic: 'A', content: '文字' },
      { topic: 'B', content: '  文字  ' }
    ])
    assert.equal(hashes.size, 1)
  })
})

describe('computeLegacyMarkdownStats', () => {
  it('計算行數與 1~6 級標題數', () => {
    const stats = computeLegacyMarkdownStats('# 一級\n內容\n## 二級\n###### 六級\n')
    assert.equal(stats.lineCount, 4)
    assert.equal(stats.headingCount, 3)
  })

  it('非行首的井字號不算標題', () => {
    const stats = computeLegacyMarkdownStats('這是 # 註解文字\n')
    assert.equal(stats.headingCount, 0)
  })

  it('依 <!-- 学习于 ... --> 標記計算學習紀錄數與含使用者識別的筆數', () => {
    const content =
      '<!-- 学习于 2026-06-24T11:06:57.253Z | 用户: test-user -->\n內容一\n' +
      '<!-- 学习于 2026-06-25T00:00:00.000Z -->\n內容二\n'
    const stats = computeLegacyMarkdownStats(content)
    assert.equal(stats.entryCount, 2)
    assert.equal(stats.entriesWithUserIdentifierCount, 1)
    assert.equal(stats.malformedTimestampCount, 0)
  })

  it('殘缺時間戳（例如 "..."）視為異常', () => {
    const stats = computeLegacyMarkdownStats('<!-- 学习于 2026-06-24T... -->\n內容\n')
    assert.equal(stats.entryCount, 1)
    assert.equal(stats.malformedTimestampCount, 1)
  })
})

describe('computeDictionaryTxtStats', () => {
  it('偵測不含分隔符的異常行', () => {
    const stats = computeDictionaryTxtStats('Term-翻譯\n沒有分隔符的行\n\nAnother-另一個\n')
    assert.equal(stats.malformedLineCount, 1)
  })

  it('空白行不計入異常', () => {
    const stats = computeDictionaryTxtStats('Term-翻譯\n\n\n')
    assert.equal(stats.malformedLineCount, 0)
  })
})

describe('computeDictionaryEntryStats', () => {
  it('偵測重複 id、術語重疊、狀態分布與缺失中文翻譯', () => {
    const stats = computeDictionaryEntryStats(
      [
        { id: '1', terms: ['BUD', 'Block Update Detector'], definition: '定義', status: 'APPROVED' },
        { id: '2', terms: ['bud'], definition: '', status: 'PENDING' }
      ],
      new Set(['1'])
    )
    assert.equal(stats.recordCount, 2)
    assert.equal(stats.emptyDefinitionCount, 1)
    assert.equal(stats.duplicateIdCount, 0)
    assert.equal(stats.termOverlapCount, 1)
    assert.deepEqual(stats.statusBreakdown, { APPROVED: 1, PENDING: 1 })
    assert.equal(stats.missingZhTranslationCount, 1)
  })

  it('相同 id 出現兩次時計入重複', () => {
    const stats = computeDictionaryEntryStats(
      [
        { id: '1', terms: [], definition: 'd', status: 'APPROVED' },
        { id: '1', terms: [], definition: 'd', status: 'APPROVED' }
      ],
      new Set()
    )
    assert.equal(stats.duplicateIdCount, 1)
  })
})

describe('computeGlossaryStats', () => {
  it('偵測空值與不分大小寫的重複 Short Form', () => {
    const stats = computeGlossaryStats(
      [
        { 'Short Form': 'BUD', 'Full Form (English)': 'Block Update Detector' },
        { 'Short Form': 'bud', 'Full Form (English)': '' },
        { 'Short Form': '', 'Full Form (English)': 'Something' }
      ],
      ['Short Form', 'Full Form (English)']
    )
    assert.equal(stats.columnCount, 2)
    assert.equal(stats.rowCount, 3)
    assert.equal(stats.emptyShortFormCount, 1)
    assert.equal(stats.emptyFullFormCount, 1)
    assert.equal(stats.duplicateShortFormCount, 1)
  })

  it('缺少 term/definition 欄位時判定 D1 缺陷仍存在', () => {
    const stats = computeGlossaryStats(
      [{ 'Short Form': 'BUD', 'Full Form (English)': 'Block Update Detector' }],
      ['Short Form', 'Full Form (English)']
    )
    const d1 = stats.knownDefects.find((d) => d.id === 'D1')
    assert.equal(d1?.active, true)
  })

  it('欄位改名為 term/definition 後判定 D1 缺陷已消失', () => {
    const stats = computeGlossaryStats(
      [{ 'Short Form': 'BUD', 'Full Form (English)': 'x', term: 'BUD', definition: 'x' }],
      ['Short Form', 'Full Form (English)', 'term', 'definition']
    )
    const d1 = stats.knownDefects.find((d) => d.id === 'D1')
    assert.equal(d1?.active, false)
  })
})

describe('hasUtf8Bom', () => {
  it('偵測開頭為 UTF-8 BOM 的 buffer', () => {
    assert.equal(hasUtf8Bom(Buffer.from([0xef, 0xbb, 0xbf, 0x61])), true)
  })

  it('沒有 BOM 時回傳 false', () => {
    assert.equal(hasUtf8Bom(Buffer.from('abc', 'utf-8')), false)
  })

  it('過短的 buffer 不誤判', () => {
    assert.equal(hasUtf8Bom(Buffer.from([0xef])), false)
  })
})

describe('detectEncoding', () => {
  it('有 BOM 回傳 utf-8-bom', () => {
    assert.equal(detectEncoding(Buffer.from([0xef, 0xbb, 0xbf, 0x61])), 'utf-8-bom')
  })

  it('沒有 BOM 回傳 utf-8', () => {
    assert.equal(detectEncoding(Buffer.from('abc', 'utf-8')), 'utf-8')
  })
})

describe('extractRelativeLinkTargets', () => {
  it('抓取本機目標、移除 fragment，並忽略外部連結與錨點', () => {
    const targets = extractRelativeLinkTargets(
      '[本地文件](./a.md#section) ![圖片](/images/b.png) ' +
        '[外部](https://example.com) [網路](//cdn.example.com/a.png) [錨點](#section)'
    )
    assert.deepEqual(targets, ['./a.md', '/images/b.png'])
  })

  it('沒有連結時回傳空陣列', () => {
    assert.deepEqual(extractRelativeLinkTargets('純文字內容'), [])
  })

  it('移除 docsify 的 ?id= 錨點參數，只保留檔案路徑', () => {
    const targets = extractRelativeLinkTargets('[章節](../BlockUpdate/01-更新概念?id=_152-比較器)')
    assert.deepEqual(targets, ['../BlockUpdate/01-更新概念'])
  })

  it('忽略純 query 錨點', () => {
    assert.deepEqual(extractRelativeLinkTargets('[同頁錨點](?id=abc)'), [])
  })
})

describe('linkTargetCandidates', () => {
  it('有副檔名時只有原路徑一個候選', () => {
    assert.deepEqual(linkTargetCandidates('./a.md'), ['./a.md'])
  })

  it('無副檔名時額外嘗試補上 .md（docsify 省略副檔名慣例）', () => {
    assert.deepEqual(linkTargetCandidates('../BlockUpdate/01-更新概念'), [
      '../BlockUpdate/01-更新概念',
      '../BlockUpdate/01-更新概念.md'
    ])
  })

  it('路徑含點號目錄但檔名無副檔名時仍嘗試 .md', () => {
    assert.deepEqual(linkTargetCandidates('../a.b/c'), ['../a.b/c', '../a.b/c.md'])
  })
})

describe('normalizeLineEndings', () => {
  it('CRLF 與單獨 CR 都正規化為 LF', () => {
    assert.equal(normalizeLineEndings('a\r\nb\rc\nd'), 'a\nb\nc\nd')
  })

  it('正規化後 CRLF 與 LF 內容的雜湊一致（跨平台可重現）', () => {
    assert.equal(
      sha256(normalizeLineEndings('a\r\nb\r\n')),
      sha256(normalizeLineEndings('a\nb\n'))
    )
  })
})

describe('classifyGtmcFile', () => {
  it('檔名含 404 判定為 not_found，優先於內容長度判斷', () => {
    const result = classifyGtmcFile('404.md', '# 標題\n某些內容也不短不短不短不短不短不短不短不短')
    assert.equal(result.fileType, 'not_found')
  })

  it('去除標題後正文過短判定為 stub', () => {
    const result = classifyGtmcFile('a.md', '# 標題\n短')
    assert.equal(result.fileType, 'stub')
  })

  it('正文足夠長且檔名正常則判定為 normal', () => {
    const content = `# 標題\n${'內容'.repeat(30)}`
    const result = classifyGtmcFile('normal.md', content)
    assert.equal(result.fileType, 'normal')
  })

  it('contentHash 等於去除頭尾空白後內容的 sha256', () => {
    const content = '  # 標題\n內容  '
    const result = classifyGtmcFile('a.md', content)
    assert.equal(result.contentHash, sha256(content.trim()))
  })
})

describe('diffValues', () => {
  it('相同值回傳空陣列', () => {
    assert.deepEqual(diffValues('sources', { a: 1 }, { a: 1 }), [])
  })

  it('巢狀物件差異回傳完整路徑', () => {
    const diffs = diffValues('sources', { a: { b: 1 } }, { a: { b: 2 } })
    assert.deepEqual(diffs, ['sources.a.b: 1 -> 2'])
  })

  it('新增或刪除欄位也視為差異', () => {
    const diffs = diffValues('sources', { a: 1 }, { a: 1, b: 2 })
    assert.deepEqual(diffs, ['sources.b: undefined -> 2'])
  })
})
