# 通用文件攝取規則（T0.5）

本文件定義任意外部文件進入知識系統的可重複執行流程：解析、品質分類、去重、AI 分流與保留策略。

規則以格式與內容特徵判定，**不得依來源名稱寫特殊邏輯**。GTMC 只是第一批輸入樣本，
不是規則的分支條件。

適用對象：`public/database/raw/` 下的所有檔案，以及未來新增的任何 Markdown、
Wiki 匯出 HTML 與純文字教學。

不適用對象：`public/database/database.json`（機器目錄，由 T1.4a 直接同步，不經本管線）、
歷史 `database.csv` 的救援遷移（另立 session 與規格）。

## 1. 名詞與唯一結果

每個 Raw 資產在一次匯入中只能有**一個**最終結果：

| 結果 | 意義 | 是否建立 Chunk | 是否可進 Answer Index |
| --- | --- | --- | --- |
| `provenance_only` | 內容與既有 canonical 資產完全相同，只建立來源追溯 | 否 | 否 |
| `excluded` | 品質規則判定不可用（404、空、導航等） | 否 | 否 |
| `candidate` | 已產生 `extraction_candidates`，但不符合 materialize 條件 | 否 | 否 |
| `pending` | 已 materialize 為待審文件、術語或知識 | 是 | 僅 `include_pending` 模式 |

匯入報告必須能對每個 Raw ID 輸出：最終結果、觸發規則、規則版本、AI run ID。
無法輸出上述四項者視為匯入失敗，不得標記 `succeeded`。

## 2. 內容雜湊正規化（canonical hash）

`raw_assets.content_hash` 不是原始位元組的 SHA-256，而是**正規化後**的 SHA-256。

理由：本倉庫 `core.autocrlf=true`，Windows 工作區為 CRLF、Git blob 為 LF。
直接雜湊原始位元組會讓同一份檔案在不同平台得到不同雜湊，去重與 manifest 全部失效。

文字檔案的正規化順序固定為：

1. 以 UTF-8 解碼；解碼失敗者視為二進位，改用原始位元組雜湊並標記 `unsupported_format`。
2. 移除開頭的 BOM（`U+FEFF`）。
3. `\r\n` 與單獨 `\r` 一律轉為 `\n`。
4. 不做其他修改：不 trim、不折疊空白、不改大小寫。

正規化只用於雜湊與比對；`raw_assets` 不保存正文，原始位元組永遠只存在 Raw 目錄檔案中。

`encoding` 欄位記錄偵測到的原始編碼與是否含 BOM，供還原與稽核使用。

## 3. 路徑契約

- 本文件與 Fixture 中的 Raw 相對路徑，一律以 `public/database/raw/` 為根，使用正斜線。
- Fixture 自帶的合成樣本以 `eval/fixtures/triage/samples/` 為根，於 Fixture 中以
  `source_root` 欄位區分。
- 整份檔案的 `logical_record_no` 為 `null`；僅 CSV 等單檔多記錄格式才使用整數記錄號。

## 4. 支援格式與 parser 行為

| 格式 | 判定 | pipeline | 保留 |
| --- | --- | --- | --- |
| Markdown | `.md`, `.markdown` | `unified` + `remark-parse` | 標題、段落、列表、引用、表格、程式碼、連結、圖片 |
| HTML / Wiki 匯出 | `.html`, `.htm` | `unified` + `rehype-parse` + `rehype-remark` | 同上，先做 DOM 裁剪 |
| 純文字 | `.txt` | 空行分段 parser | 非空段落與換行列表 |

純文字沒有標題語法，因此第一個非空行作為文件標題，其餘內容全部屬於單一根區段；
不從內文猜測次級標題。`/learn` 投稿在寫入 Raw 後亦以此格式處理。

其他副檔名建立 `unsupported_format` 旗標，結果為 `excluded`，不建立 AI job。

HTML 裁剪規則（解析前執行，不執行任何 HTML、JavaScript 或外部請求）：

1. 移除 `script`、`style`、`noscript`、`iframe`、`form`、`nav`、`footer`、`header`、
   `aside`、`svg`。
2. 內容根依序取第一個 `article`、否則 `main`、否則 `body`。
3. 表格轉為含欄名的 Markdown 表格；`pre/code` 保留語言 class 與原文。
4. 圖片只保留 `alt` 與 `src`，不下載任何資源。

parser 失敗建立 `parse_error` 旗標並保留 Raw；**不得**回退成把整份檔案無結構丟給 AI。

### heading_path 格式

以 `>` 連接各層標題文字，兩側各一個半形空格，不含 `#` 與層級編號補字：

```text
#01 刻与刻间时序 > 1.3 充能理论
```

同層重複標題以出現順序在尾端加 `#2`、`#3`。標題文字保留原文，不做大小寫或空白改寫。

## 5. 確定性前置規則

AI 之前先執行，全部為純函式，可單獨測試。規則版本以 `ingestion_rules_version` 記錄。

| 編號 | 規則 | 產生旗標 | 結果 |
| --- | --- | --- | --- |
| R1 | CSV 僅以 RFC 4180 parser 讀取，禁止按換行切割 | `parse_error`（失敗時） | 依解析結果 |
| R2 | 正規化後正文為空，或僅有一個標題而無任何內容區塊 | `empty` | `excluded` |
| R3 | 內容宣告本頁不存在或未完成（見 5.1） | `not_found` | `excluded` |
| R4 | 區段層級排除後不剩任何可切 Chunk 的區段（見 5.2） | `navigation` 或 `empty` | `excluded` |
| R5 | 區段無內容、內容為連結清單或低於內容下限（見 5.3） | `stub` / `navigation` | 該區段不切 Chunk |
| R6 | 站內相對連結或圖片指向不存在的檔案 | `broken_link` | 保留正文，不刪連結語法 |
| R7 | 正規化雜湊與既有資產完全相同 | `duplicate_exact` | `provenance_only` |
| R8 | 術語比對鍵正規化（見 5.5） | 無 | 只影響比對，不影響結果 |

### 5.1 `not_found` 判定

文件正文（扣除標題與圖片）在 200 字元以內，且命中「本頁不存在」語意樣式，例如
`PageNotFound`、`404`、`还没完成`、`敬请期待`、`coming soon`、`under construction`。

判定必須同時滿足長度與樣式兩個條件，避免把正常文章中提及 404 的段落誤判。

### 5.2 文件層級的 `navigation` / `empty`

**不使用**整份文件的連結字元比例判定導航。實測顯示比例門檻無法分離真實案例：
`BlockUpdate/README.md` 是目錄頁卻有 94 字元的章節引言，`LoadingTicket/00-序.md`
是序言頁卻有 84% 連結字元，任何單一比例都會誤判其中一邊。

改為先做 5.3 的區段層級排除，再看剩下什麼：

- 仍有可切 Chunk 的區段 → 文件正常建立 `documents` 與 `document_chunks`。
- 沒有任何可切 Chunk 的區段，且至少一個區段因連結清單被排除 → `navigation`，`excluded`。
- 沒有任何可切 Chunk 的區段，且無連結清單區段 → `empty`，`excluded`。

好處是判定與「這份文件到底能不能被引用」直接對齊，而不是猜測作者意圖。

### 5.3 區段層級的排除

區段 = 一個標題及其下、次一個同級或更高級標題之前的所有內容區塊。
H1 之前的內容視為文件根區段。

依序套用，命中即排除該區段，不否定整份文件：

| 條件 | 旗標 |
| --- | --- |
| S1 區段無任何內容區塊 | `stub` |
| S2 區段內容區塊有 ≥ 80% 為連結項目（站內或外部皆計） | `navigation` |
| S3 區段敘述文字 < 120 字元，且不含表格、程式碼區塊或圖片 | `stub` |
| S4 區段內容含未完成標記（見下） | `stub` |

S4 的未完成標記為作者明示的待補宣告，不是語意猜測。命中樣式（不分大小寫）：
`暂未完成`、`暫未完成`、`未完成`、`待补充`、`待補充`、`待写`、`待寫`、`TODO`、`TBD`、
`WIP`、`coming soon`、`under construction`。

標記出現在區段內任一位置即排除整個區段：作者已宣告該段不可信，保留半份內容比不保留更危險。
整份文件皆為未完成標記時由 R3 處理為 `not_found`。

S3 的 120 字元下限套用於所有區段，包含 `概述`、`序`、`引言` 一類章節引言；
不因標題名稱而例外。含表格、程式碼區塊或圖片的短區段不受下限限制，因為其資訊量不在字數。

行內程式碼（`` `foo` ``）**不算**程式碼區塊，不觸發豁免；只有 fenced 或縮排程式碼區塊算。
否則一句帶有類別名稱或版本字串的引言就會被誤留為可引用內容。

敘述文字的計算：扣除標題、連結語法與圖片語法後的可讀文字長度。

文件的 `expected_completed_headings` 與 `excluded_headings` 即由此規則決定。

### 5.4 `broken_link` 判定

只檢查站內相對連結與圖片（`./`、`../` 或不含 scheme 的路徑），以 Raw 目錄實際檔案存在性判定。

外部 URL 一律不在匯入時請求，不因無法連線而標記；外部連結有效性不屬於本管線責任。

### 5.5 術語比對鍵正規化

與既有詞典、Glossary 比對術語時，只能對**比對鍵**做正規化，Raw 原文與 Chunk 正文一律保持原樣。

比對鍵的正規化：轉小寫、全形轉半形、連續空白收斂為單一空格、去除頭尾空白、
去除成對括號及其內容（`Block Update Detector (BUD)` → `block update detector`）。

禁止把正規化結果寫回 Raw、Chunk、`normalized_content` 或任何可引用內容。
`Signal Strength` 與 `signal strength` 命中同一個比對鍵，但兩者的原始寫法都必須可還原。

大小寫或空白差異**不構成** `duplicate_exact`；`duplicate_exact` 只看第 2 節的正規化雜湊。

## 6. 去重與 provenance

1. 以 `(source_id, content_hash, logical_record_no)` 唯一索引擋下同來源重複匯入。
2. 跨路徑或跨來源出現相同正規化雜湊時，保留**所有** Raw 資產，但只選一個 canonical。
3. canonical 選擇規則固定且可重現：相對路徑字典序最小者。
4. 其餘副本結果為 `provenance_only`，只建立來源追溯關係，不建立文件、Chunk 或向量。
5. 近似重複（`duplicate_near`）本期只標旗標供人工檢視，不自動處理，也不列入 Fixture 契約。
6. 去重**優先於**內容品質規則（R2–R6）。判定為 `duplicate_exact` 的資產只記錄該旗標，
   不再重複執行品質判定；品質結論以 canonical 資產為準，避免同一問題被記錄多次。

## 7. AI 分流

掃描器只建立 `ai_jobs`，不在掃描流程直接呼叫模型。

### 7.1 Flash：`document_triage`

輸入為單一 Raw 資產的解析結果。輸出必須通過 JSON schema：

```text
{
  candidate_type: 'term' | 'community_note' | 'claim' | 'discard' | 'needs_review',
  normalized_title: string,
  normalized_content: string,
  term_refs: string[],
  source_raw_asset_id: number,
  quality_flags: string[],
  confidence: number,
  rationale: string
}
```

規則：

- 無法判斷、資訊不足或發現互相衝突的事實時，必須輸出 `needs_review`，不得猜測。
- `quality_flags` 只能使用 `src/db/enums.ts`（T0.2）定義的值。
- `term_refs` 是文字形式的術語候選，不是資料庫 ID；比對交給 T2.6。
- 模型不得輸出審核狀態、`approved` 或任何最終決定。

### 7.2 Pro 的介入條件

只有下列情形才建立 Pro job，其餘一律不使用 Pro：

1. Flash 輸出 `conflicting_fact` 或 `mixed_concepts`。
2. 同一議題跨多個文件或詞典來源。
3. Flash 輸出 `needs_review` 且信心值低於 0.5。

Pro 的輸出仍然只是 `extraction_candidates`，不得直接建立正式資料。

### 7.3 失敗處理

AI 回應不是合法 JSON、schema 驗證失敗或 `source_raw_asset_id` 回鏈錯誤時：

- `ai_runs.status` 記為 `invalid`，保存原始輸出。
- 不建立任何候選。
- Raw 結果維持 `candidate` 之前的狀態，等待重試；**不得**因 AI 失敗而讓資料前進。

## 8. materialize 規則

候選同時滿足下列條件時，自動建立 `pending` 項目：

1. 具有有效的 Raw 回鏈。
2. JSON 通過 schema 驗證。
3. `normalized_content` 非空。
4. 不帶任何阻擋旗標。

阻擋旗標（不 materialize）：`empty`、`stub`、`navigation`、`not_found`、
`duplicate_exact`、`unsupported_format`、`parse_error`。

只建立 `needs_review` 候選、永不 materialize：`possible_typo`、`mixed_concepts`、
`conflicting_fact`。

`candidate_type = 'discard'` 不 materialize。

**任何路徑都不得產生 `approved`。** 由 `pending` 到 `approved` 只能經人工審核（Phase 3）。

## 9. 回歸測試策略

即時 Flash / Pro 只對新 Raw 資料呼叫。回歸測試**不呼叫模型**，改重播 Fixture，驗證：

1. JSON schema 與必要欄位。
2. Raw 回鏈正確。
3. 確定性旗標與預期一致。
4. materialize 決策與預期一致。
5. 去重與 canonical 選擇正確。
6. 審核狀態隔離：任何 Fixture 都不得產生 `approved`。
7. 餵入未知或不合法 AI JSON 時，資料不得跳過 `pending`。

### 不合法 AI 回覆的測試變體

不另存「壞掉的 Fixture」檔案，改由 runner 從種子 Fixture**即時衍生**變體。
理由：壞掉的 JSON 無法通過本文件自己的 Fixture 契約檢查，存成檔案會讓契約自相矛盾。

runner 至少產生下列變體，每一種都必須被拒絕且不建立任何候選：

| 變體 | 期望行為 |
| --- | --- |
| 截斷的 JSON 字串 | `ai_runs.status = 'invalid'`，保存原始輸出，不建立候選 |
| `candidate_type` 為未知值 | 同上 |
| `source_raw_asset_id` 指向不存在的資產 | 同上，且不得建立孤兒候選 |
| 回覆多帶 `status: "approved"` 欄位 | 欄位被忽略，資料不得跳過 `pending` |
| `quality_flags` 含枚舉外的值 | 同上 |
| `confidence` 超出 0–1 | 同上 |

本 Track 只交付規則與 Fixture 契約；重播 runner 依賴 T1.1／T1.2 的 DB 與匯入器，
於對應 Track 實作。

### Fixture 檔案

```text
eval/fixtures/triage/
  document-expected.json
  duplicate-provenance.json
  samples/
    wiki-export-hopper.html
    community-note-hopper.txt
  ai-responses/
    document-triage/<raw-content-hash>.json
    document-quality/<raw-content-hash>.json
    conflict-review/<raw-content-hash>.json
```

AI 回覆 Fixture 的檔名為**輸入 Raw 內容的正規化 SHA-256**，不使用模型生成的標題。
每份必須包含 `task_type`、`model`、`prompt_version`、`input_hash`、`response`、
`approved_by`、`approved_at`。

模型升級或 prompt 變更時，舊 Fixture **不覆蓋**；以新版本檔案並列保存，
由評測題庫（T0.4）指定採用版本。

### Fixture 的 Raw 回鏈佔位

Fixture 寫入時不可能知道 `raw_assets.id`，因此 `response.source_raw_asset_id`
一律固定為 `0`。重播 runner 必須：

1. 先驗證 Fixture 中的值為 `0`（不是 `0` 表示 Fixture 被手動竄改，測試失敗）。
2. 以本次插入的實際 `raw_assets.id` 取代後，才交給 schema 與回鏈驗證。

### 目前 Fixture 的來歷

`ai-responses/` 下的 6 份為**人工撰寫並核准**的種子契約，不是模型錄製輸出。
它們定義「合格輸出長什麼樣」，供規則層在管線可執行前就能被測試。

T2.4 匯入器實作後，必須以真實 Flash／Pro 輸出重新錄製同一批 `input_hash` 的回覆，
與種子契約逐欄比對；差異須由知識審核者裁決後才更新 Fixture。

## 11. 對 T0.2 枚舉的新增需求

本文件用到兩個 KNOWLEDGE_SYSTEM_PLAN.md 的品質旗標清單尚未包含的值：

| 旗標 | 用途 | 來源規則 |
| --- | --- | --- |
| `unsupported_format` | 副檔名不在支援清單 | 第 4 節 |
| `parse_error` | Markdown / HTML parser 失敗 | 第 4 節、R1 |

T0.2 建立 `src/db/enums.ts` 時必須一併納入這兩個值，否則本文件的規則無法以枚舉表達。
在 T0.2 合併前，本文件是這兩個值的唯一定義處。

## 12. 與 KNOWLEDGE_SYSTEM_PLAN.md 的差異

本文件在三處與計畫的 T0.5 條文不同。差異都是實作時對照真實資料後的修正，
不是省略；採用本文件版本前應確認計畫文件同步更新。

| 項目 | 計畫原文 | 本文件 |
| --- | --- | --- |
| 內容雜湊 | 原始內容的 SHA-256 | 正規化後的 SHA-256（第 2 節） |
| 導航判定 | 「純導航」為文件層級判定 | 先做區段層級排除，再看剩餘區段（第 5.2 節） |
| triage 粒度 | 每個非重複 Raw **區塊**輸出候選 | 每個 Raw **資產**輸出一個候選 |

理由：

1. 倉庫 `core.autocrlf=true`，工作區 CRLF 而 blob LF；原始位元組雜湊跨平台不一致，
   會讓去重與 manifest 全部失效。
2. 實測任何單一連結比例門檻都會誤判 `BlockUpdate/README.md` 或
   `LoadingTicket/00-序.md` 其中一邊。
3. 區塊級呼叫成本與輸出量隨文件長度線性成長，逐塊判斷又失去全文脈絡；
   導航頁與 404 頁在區塊級也無法整份排除。區段取捨改由第 5.3 節的確定性規則負責。

第三項是本期最可能需要回頭調整的：若 Phase 2 發現長文件的單一候選過於粗糙，
可在不改變確定性規則的前提下，改為對已通過 5.3 的區段各發一次 `document_triage`。
屆時 Fixture 的 `input_hash` 需改以區段內容計算，本節必須同步更新。

### 變更流程

新增 parser、品質規則或旗標時，必須同時：

1. 加入對應 Fixture 案例。
2. 更新本文件的規則表與規則版本。
3. 由知識審核者核准。

缺少任一項的變更不得合併。

## 10. 目前 Fixture 涵蓋的案例

| 案例 | 來源 | 驗證重點 |
| --- | --- | --- |
| 完整技術文章 | `gtmc-database/MicroTiming/01-刻与刻间时序.md` | 標題路徑、公式與圖片保留、Claim 候選 |
| 序言＋目錄頁 | `gtmc-database/LoadingTicket/00-序.md` | 引言低於內容下限、目錄與參考文獻為連結清單 |
| 部分完成文件 | `gtmc-database/LoadingTicket/02-加载票系统的运作细节.md` | `stub` 區段不進索引，已完成段落保留 |
| 外部連結清單 | `gtmc-database/LoadingTicket/a-附页-辅助mod.md` | 外部連結不檢查；圖片與程式碼豁免內容下限 |
| 譯名表格 | `gtmc-database/LoadingTicket/b-附页-一些译名.md` | 表格欄列關係保留、術語候選 |
| 純導航頁 | `gtmc-database/Appendix/00-专有名词解释.md` | `navigation` 排除 |
| 導航頁＋失效連結 | `gtmc-database/BlockUpdate/README.md` | `navigation` + `broken_link` 併存 |
| 404 頁 | `gtmc-database/EntityAI/404.md` | `not_found` 排除 |
| 404 重複頁 | `gtmc-database/EntityMove/404.md` | `duplicate_exact` → `provenance_only` |
| 僅標題空文件 | `gtmc-database/EntityAI/00-序.md` | `empty` 排除 |
| 空文件重複 | `gtmc-database/EntityMove/00-序.md` | 空內容同時重複時仍走 provenance |
| Wiki 匯出 HTML | `samples/wiki-export-hopper.html` | DOM 裁剪、表格與程式碼保留 |
| 純文字社群筆記 | `samples/community-note-hopper.txt` | 版本未知＋衝突事實 → `needs_review` |
| `/learn` 投稿 | `samples/learn-submission-observer.txt` | 自帶版本的社群投稿 → `pending`，永不 `approved` |

最後兩例互為衝突對：HTML 樣本敘述漏斗冷卻 8gt 且限定 Java 1.21，
文字樣本主張固定 7gt 且宣稱全版本適用，用於驗證 `conflicting_fact` 與 Pro 介入路徑。
