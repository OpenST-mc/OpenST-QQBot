# Minecraft 知識系統規劃

## 目標

建立一個長期可維護、可追溯且能精準回答複雜 Minecraft 技術問題的知識系統。

系統以 Human-in-the-Loop、Evidence-based RAG 為原則：AI 只能根據已檢索到的證據回答；自動整理出的結論不可直接成為正式知識。

本文件描述以目前倉庫已有資料為基礎的實作順序，不在此階段實作 Litematica 解析、Minecraft 原始碼 AST/Symbol 解析、Call Graph 或自動化遊戲實測。

## 範圍

### 本期納入

| 類別 | 現有來源 | 用途 |
| --- | --- | --- |
| 機器作品 | `public/database/database.json` | 機器推薦、條件與設計案例 |
| 社群知識 | `public/database/database.csv` | 已整理的技術知識與人工學習內容 |
| 社群原始紀錄 | `public/database/database.md` | 匯入時追溯既有知識來源 |
| 儲存科技詞典 | `public/database/dictionary/` | 英文詞條、中文翻譯、別名與引用關係 |
| 舊術語對照 | `public/database/Dictionary.txt` | 補充別名與翻譯候選 |
| 多語詞彙表 | `public/database/TechMC Glossary.csv` | Minecraft 多語術語與定義 |
| GTMC 文件 | `public/database/gtmc-database/` | 經典技術文件、機制與版本知識 |

### 本期不納入

| 項目 | 原因 | 後續條件 |
| --- | --- | --- |
| Litematica 與測試世界解析 | 結構特徵不等於實際機制或效能證據 | 建立實驗資料模型後再做 |
| Minecraft 原始碼 AST/Symbol/Call Graph | 必須先解決版本、Mapping 與授權追溯 | 文件與 Claim 流程穩定後再做 |
| 自動化遊戲測試 | 需要受控環境與可重現腳本 | 實驗資料規範完成後再做 |
| 未審核網頁爬取 | 來源品質、授權與版本難以控制 | 建立來源政策後再做 |

## 目前資料的問題與定位

| 資料 | 目前狀態 | 目標定位 | 遷移處理 |
| --- | --- | --- | --- |
| `database.json` | 只讀 JSON，推薦時全量載入 | 正式機器目錄 | 匯入 `machines` 與 `machine_tags` |
| `database.csv` | `topic,content`，沒有來源、版本或審核資料 | 一般知識的既有匯入來源 | 匯入 `knowledge_entries`，預設標記為 legacy |
| `database.md` | 可閱讀的舊學習日誌，不在執行期讀取 | 原始來源或人工佐證 | 匯入為文件，不直接當正式 Claim |
| `dictionary/entries` | 英文詞條與 Discord 來源 | 正式術語原始來源 | 匯入 `terms`、`term_aliases`、`term_evidence` |
| `zh-translations.json` | 中文術語與定義 | 正式翻譯來源 | 匯入 `term_translations` |
| `Dictionary.txt` | 人工中英對照，不在執行期讀取 | 補充翻譯候選 | 匯入待比對，避免覆蓋正式詞典 |
| `TechMC Glossary.csv` | 多語 CSV；欄位與現有程式期待不一致 | 多語術語來源 | 依實際欄位轉換後匯入 |
| `gtmc-database` | Markdown 文件，不在執行期直接檢索 | 高可信技術文件 | 依標題與段落匯入 `documents`、`document_chunks` |

## 核心原則

1. SQLite 是執行期唯一權威資料庫；JSON、CSV、Markdown 保留為匯入來源、備份與人工編輯素材。
2. 每筆可用於回答的資料都必須能追溯來源、授權、版本、環境、建立時間與審核狀態。
3. 原始文件、段落、術語、知識條目、Claim、機器作品不可混為同一種資料。
4. 正式回答預設只使用已核准的內容；待審資料僅供管理者檢視與審核。
5. AI 摘要、AI 抽取或使用者補充只能建立 Candidate Claim 或待審知識，不能直接污染正式檢索。
6. 回答必須區分已驗證事實、條件式推論與尚待確認的假設。
7. Minecraft Java/Bedrock、遊戲版本、Vanilla/Fabric/Paper 等環境是檢索與回答的必要條件，不是純文字備註。

## 資料生命週期

```text
原始檔案或人工輸入
  -> 匯入隔離區
  -> 解析、去重、版本與來源標記
  -> 文件/術語/知識候選
  -> 人工審核
  -> 已核准文件段落與 Verified Claim
  -> FTS5 + 向量索引
  -> 混合檢索
  -> 證據工作區
  -> AI 回答與引用
  -> 錯誤回報回到待審區
```

隔離區可建立搜尋索引供審核者研究，但不得進入使用者正式回答的 Answer Index。

## SQLite 資料模型

### 來源與文件

| 表 | 必要欄位 | 用途 |
| --- | --- | --- |
| `sources` | `id`, `type`, `name`, `url`, `license`, `trust_level`, `created_at` | 登記 GTMC、詞典、社群資料等來源 |
| `documents` | `id`, `source_id`, `path_or_url`, `title`, `language`, `content_hash`, `status`, `created_at`, `updated_at` | 一篇完整 Markdown、日誌或匯入文件 |
| `document_versions` | `id`, `document_id`, `content`, `content_hash`, `imported_at` | 保留文件修訂，避免直接覆蓋歷史 |
| `document_chunks` | `id`, `document_id`, `heading_path`, `content`, `chunk_index`, `token_count`, `status` | 可被搜尋及引用的最小文件段落 |

### Minecraft 範圍與適用條件

| 表 | 必要欄位 | 用途 |
| --- | --- | --- |
| `version_scopes` | `id`, `edition`, `version_min`, `version_max`, `loader`, `server_implementation`, `notes` | 統一描述 Java/Bedrock、版本與執行環境 |
| `content_version_scopes` | `content_type`, `content_id`, `version_scope_id` | 將文件、Claim、機器、知識條目連到適用範圍 |

未知版本不可假裝適用全部版本，必須標示為 `unknown` 或待審核。

### 術語系統

| 表 | 必要欄位 | 用途 |
| --- | --- | --- |
| `terms` | `id`, `canonical_name`, `category`, `status`, `source_id` | 一個技術概念的核心實體 |
| `term_aliases` | `id`, `term_id`, `alias`, `language`, `alias_type` | 中英名稱、縮寫、社群俗稱與舊稱 |
| `term_translations` | `id`, `term_id`, `language`, `display_name`, `definition` | 各語言名稱與定義 |
| `term_relations` | `from_term_id`, `relation_type`, `to_term_id` | `related_to`、`uses`、`not_equivalent_to` 等關係 |
| `term_evidence` | `term_id`, `document_chunk_id`, `source_id` | 詞條定義的證據與來源 |

範例：`Block Update Detector`、`BUD`、`方块更新检测器`、`方塊更新檢測器` 應指向同一個 `terms.id`。

### 一般知識與 Claim

| 表 | 必要欄位 | 用途 |
| --- | --- | --- |
| `knowledge_entries` | `id`, `title`, `content`, `kind`, `source_id`, `status`, `confidence`, `created_at`, `updated_at` | 教學、設計原則、社群整理等一般內容 |
| `knowledge_terms` | `knowledge_id`, `term_id` | 將一般內容連結到術語 |
| `claims` | `id`, `statement`, `status`, `confidence_level`, `created_at`, `updated_at` | 可獨立驗證的技術敘述 |
| `claim_conditions` | `id`, `claim_id`, `condition_type`, `content` | 版本、環境、前置條件與適用限制 |
| `claim_exceptions` | `id`, `claim_id`, `content` | 例外、已知反例與失效情境 |
| `claim_evidence` | `claim_id`, `evidence_type`, `evidence_id`, `stance`, `note` | 支持或反對 Claim 的文件段落與其他證據 |
| `claim_relations` | `from_claim_id`, `relation_type`, `to_claim_id` | `supports`、`conflicts_with`、`supersedes` 等關係 |
| `reviews` | `id`, `target_type`, `target_id`, `reviewer_id`, `decision`, `comment`, `created_at` | 人工審核紀錄 |

`claims.statement` 應是一句可完整驗證的敘述，不應只是零散標籤。例如「Java 1.21+ 原版中，漏斗成功傳輸後通常設定 8gt 冷卻；特定時序條件下可能為 7gt」。

建議狀態：`pending`、`approved`、`rejected`、`deprecated`、`disputed`。

建議可信度：`documented`、`expert_reviewed`、`measured`、`inferred`、`unverified`。

### 機器作品

| 表 | 必要欄位 | 用途 |
| --- | --- | --- |
| `machines` | `id`, `name`, `author`, `description`, `preview_path`, `filename`, `sub_id`, `status`, `created_at`, `updated_at` | 取代 `database.json` 的作品目錄 |
| `machine_tags` | `machine_id`, `tag` | 版本、用途、特性等可查詢標籤 |
| `machine_terms` | `machine_id`, `term_id` | 將機器與技術概念連結 |
| `machine_relations` | `machine_id`, `relation_type`, `related_machine_id` | 相容、替代、改良版等關係，後期再啟用 |

第一版可沿用現有「名稱、標籤、作者」關鍵字推薦邏輯，只將資料來源改為 SQLite；不必在遷移時同時改變推薦行為。

### 實驗資料的預留結構

本期不自動收集 Carpet、Spark 或測試世界資料，但預留資料結構，避免將來破壞性遷移。

| 表 | 必要欄位 | 用途 |
| --- | --- | --- |
| `experiments` | `id`, `title`, `status`, `version_scope_id`, `setup`, `procedure`, `created_at` | 一次可重現測試的條件與步驟 |
| `experiment_measurements` | `experiment_id`, `metric`, `value`, `unit`, `sample_count`, `notes` | 產量、MSPT、實體數等結果 |
| `experiment_evidence` | `experiment_id`, `document_chunk_id`, `attachment_ref` | 截圖、日誌或相關文件佐證 |

## 匯入與去重策略

### 匯入基本流程

1. 建立或確認 `source`。
2. 保存原始內容與 SHA-256 `content_hash`。
3. 同一來源、同一路徑、同一雜湊的內容不重複匯入。
4. 解析文件結構、術語、版本提示與候選內容。
5. 匯入資料預設進入 `pending` 或依來源政策決定狀態。
6. 僅在人工審核後進入 Answer Index。

### 既有資料的初始狀態

| 資料 | 建議初始狀態 | 理由 |
| --- | --- | --- |
| 已核准詞典原文與既有中文翻譯 | `approved` | 有明確詞典來源與既有審核標記 |
| GTMC 文件段落 | `approved` 或 `documented` | 保留來源與授權後可作高可信文件 |
| `database.json` 的機器中繼資料 | `approved` | 為既有正式機器目錄 |
| `database.csv` | `pending` 或 `legacy_review` | 現有內容缺乏逐筆來源、版本與審核資訊 |
| `database.md` | `pending` 文件 | 主要作為追溯 CSV 與社群知識的來源 |
| `Dictionary.txt` | `pending` 翻譯候選 | 可能與正式詞典翻譯衝突 |
| `TechMC Glossary.csv` | `pending` 匯入批次 | 先正確映射欄位並處理重複詞條 |

## 文件解析與切段規則

1. Markdown 依 `#` 到 `######` 標題建立 `heading_path`。
2. 一個段落區塊保持完整語意；不要使用固定字數硬切斷定義、條件或列表。
3. 表格應保留欄名與列關係，轉成可引用文字或結構化欄位。
4. 程式碼區塊本期保留原文與語言標記，但不做 AST 解析。
5. 一個 chunk 過長時僅在段落邊界切分，並帶入父標題。
6. 每個 chunk 必須可回鏈到文件、標題位置、來源與版本範圍。

## 搜尋與回答設計

### 索引

| 索引 | 技術 | 搜尋目標 |
| --- | --- | --- |
| 全文索引 | SQLite FTS5 / BM25 | 精確術語、版本號、縮寫、機器名稱 |
| 語意索引 | 現有 Sentence-BERT Embedding | 自然語言問題與相近概念 |
| 術語索引 | `terms`、`term_aliases` | 中英名稱、縮寫、社群俗稱展開 |
| Metadata 篩選 | SQLite 條件查詢 | 狀態、版本、平台、來源可信度 |

第一版可把向量保留在應用程式記憶體中，但必須依 `updated_at` 或索引版本決定是否重建；不可像目前一樣每次 `/ask` 都重新向量化全部資料。

### Query Planner

收到問題後，先嘗試辨識：

1. 目標：定義、機制解釋、設計比較、故障排查、機器推薦或效能分析。
2. Minecraft 範圍：Java/Bedrock、版本、Vanilla/Fabric/Paper 等。
3. 涉及術語及其別名。
4. 缺少但會影響結論的條件。

版本或平台不可推定時，回答應明確說明採用的假設，或優先詢問使用者補充。

### Hybrid Retrieval

1. 以術語別名展開查詢。
2. 對 Answer Index 執行 FTS5/BM25 與向量搜尋。
3. 使用版本、環境、狀態與可信度過濾或降權。
4. 將兩種搜尋結果以 RRF 或等效策略合併。
5. 重排序時提高「術語精確命中、版本相容、已核准、直接回答問題」的權重。
6. 對複雜問題選取多個互補證據，而不是只取單一最高分段落。

### Evidence Workspace

每次回答建立暫時的證據工作區，至少包含：

| 分類 | 內容 |
| --- | --- |
| 支持證據 | 直接支持結論的 Claim 與文件段落 |
| 反證 | 不同版本、不同環境或相反結論 |
| 條件限制 | 版本、平台、前置條件與例外 |
| 缺失資訊 | 沒有資料或使用者未提供的必要條件 |
| 候選方案 | 不同設計的優勢、限制與適用場景 |

AI 必須以工作區內容作答，不可把待審內容敘述成已確認事實。

### 回答格式

正式回答至少包含：

1. 結論。
2. 適用版本、平台與必要條件。
3. 依據與來源連結或條目識別。
4. 不確定性、衝突資料或未驗證部分。
5. 若適用，提供可重現的測試或確認方式。

回答中應明確使用下列語氣區分：

| 類型 | 建議表述 |
| --- | --- |
| 已驗證事實 | 「已知機制是...」 |
| 有條件的結論 | 「在 Java 1.20+ 原版且...時，通常...」 |
| 證據導出的推論 | 「根據這些條件，可推測...」 |
| 缺少證據 | 「目前資料不足以確認...」 |

## 審核流程

```text
/learn、AI 摘要、CSV/Markdown 匯入
  -> pending 知識或 Candidate Claim
  -> 審核者確認來源、版本、條件與例外
  -> 附上支持證據與已知反證
  -> approved / rejected / deprecated / disputed
  -> 更新 Answer Index
```

自動學習的原始訊息、附件摘要與 AI 提取結果必須保留，以便審核者追查來源。自動學習不得直接寫入 `approved` 資料。

錯誤回報不可直接覆蓋舊知識；應建立新 Claim、反證、修訂或版本範圍修正，保留原有歷史。

## 實作階段

| 階段 | 內容 | 產出 | 完成條件 |
| --- | --- | --- | --- |
| 0 | 資料政策與盤點 | 來源政策、授權紀錄、狀態與可信度定義 | 每種現有資料都有來源與匯入規則 |
| 1 | SQLite 基礎與機器遷移 | `sources`、`machines`、`machine_tags`、匯入工具 | JSON 與 SQLite 的機器數、`sub_id`、標籤數一致；推薦行為不回歸 |
| 2 | 文件與術語遷移 | 文件、段落、術語、別名、翻譯表與匯入工具 | 可從中文、英文、縮寫命中相同概念並追溯來源 |
| 3 | 知識與 Claim 審核 | `knowledge_entries`、`claims`、證據、審核資料與管理命令 | 待審內容不會出現在一般回答中 |
| 4 | 混合檢索 | FTS5、向量索引版本化、Metadata 篩選、重排序 | 不再每次 `/ask` 重建完整索引；結果含版本與來源 |
| 5 | 證據式回答 | Evidence Workspace、回答引用、衝突與不確定性規則 | 複雜問題能列出支持證據、限制與未知項 |
| 6 | 實驗資料 | 人工匯入 `experiments` 與測量資料 | 可將可重現實測連到 Claim，但不自動測試 |

## 評測與維護

建立至少 30 到 50 題的固定評測題庫，分為：

| 類型 | 示例 |
| --- | --- |
| 術語定義 | 「BUD 和 QC 的關係是什麼？」 |
| 別名搜尋 | 「方塊更新檢測器與 BUD 是否相同？」 |
| 版本限制 | 「某 1.12 機制在 1.21 是否仍適用？」 |
| 多證據推理 | 「為什麼不可堆疊分類需要限速？」 |
| 機器推薦 | 「1.20+ 的不可堆疊打包可選哪些作品？」 |
| 衝突處理 | 「兩份資料給出不同說法時，能否指出版本與條件？」 |
| 拒答能力 | 「資料庫沒有證據時，是否明確說不知道？」 |

每次調整匯入、切段、搜尋、重排序、提示詞或審核規則，都應重新執行題庫並記錄：命中證據正確性、版本正確性、引用正確性、回答完整性與幻覺情況。

## 遷移完成後的檔案政策

| 檔案 | 遷移後定位 |
| --- | --- |
| `database.json` | 匯入來源與備份；不再由 Bot 執行期直接讀取 |
| `database.csv` | 歷史匯入來源；`/learn` 不再追加寫入 |
| `database.md` | 原始文件與人工可讀歷史紀錄 |
| `Dictionary.txt` | 補充匯入來源；不再直接使用 |
| `dictionary/` | 詞典原始來源與可重匯入資料 |
| `TechMC Glossary.csv` | 多語詞彙表原始來源與可重匯入資料 |
| `gtmc-database/` | GTMC 文件原始來源與可重匯入資料 |
| SQLite 資料庫 | Bot 執行期唯一讀寫資料來源 |

## 非目標

1. 不將所有資料壓縮為單一長文字知識庫。
2. 不讓 AI 自行決定資料是否已驗證。
3. 不因為向量相似度高就忽略版本、環境與來源可信度。
4. 不將 Litematic 的靜態結構分析誤作效能或可靠性證據。
5. 不將未知版本的原始碼或社群說法當作跨版本規則。
6. 不在沒有評測題庫前宣稱檢索品質提升。
