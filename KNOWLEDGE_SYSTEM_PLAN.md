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
| `sources` | `id`, `public_id`, `type`, `name`, `creator`, `url`, `license`, `license_url`, `visibility`, `trust_level`, `created_at` | 登記 GTMC、詞典、社群資料等來源；`public_id` 是對外穩定引用 ID，`visibility` 控制是否可公開 |
| `import_runs` | `id`, `source_id`, `importer_version`, `started_at`, `finished_at`, `status`, `summary` | 保留每次匯入的版本、結果與錯誤，不讓匯入成為不可追溯覆蓋 |
| `raw_assets` | `id`, `import_run_id`, `source_path`, `content`, `content_hash`, `encoding`, `logical_record_no`, `status` | 原始檔、CSV 邏輯記錄或 Markdown 快照；永不因清理而遺失 |
| `content_quality_flags` | `id`, `raw_asset_id`, `flag_type`, `detected_by`, `evidence`, `status` | 404、空內容、導航、重複、拼寫疑慮、衝突或未完成等品質旗標 |
| `documents` | `id`, `source_id`, `path_or_url`, `title`, `language`, `content_hash`, `status`, `created_at`, `updated_at` | 一篇完整 Markdown、日誌或匯入文件 |
| `document_versions` | `id`, `document_id`, `content`, `content_hash`, `imported_at` | 保留文件修訂，避免直接覆蓋歷史 |
| `document_chunks` | `id`, `document_id`, `heading_path`, `content`, `chunk_index`, `token_count`, `status` | 可被搜尋及引用的最小文件段落 |
| `source_references` | `id`, `public_id`, `source_id`, `document_id`, `document_chunk_id`, `display_title`, `creator`, `source_url`, `source_anchor`, `visibility`, `modification_note` | 回答引用與來源網站使用的穩定條目；可連至文件或精確段落 |
| `answer_feedback_items` | `id`, `feedback_id`, `ordinal`, `statement`, `verdict`, `reason`, `evidence_refs` | 「部分正確」判定時拆出的原子知識點與逐點判定 |

文件 Chunk 的 FTS5 與向量索引應以 `document_chunks.id` 關聯，不直接取代原始段落內容。

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
| `answer_feedback` | `id`, `answer_message_id`, `question`, `answer`, `evidence_snapshot`, `reviewer_id`, `verdict`, `reason`, `created_at` | 使用者對 Bot 回答的正確／錯誤判定與可追溯證據快照 |
| `knowledge_settings` | `key`, `value`, `updated_by`, `updated_at` | 管理者可變更的知識系統設定，例如試用模式 |
| `knowledge_setting_audit` | `id`, `key`, `old_value`, `new_value`, `changed_by`, `changed_at` | 試用模式等設定切換的不可竄改稽核紀錄 |
| `ai_runs` | `id`, `task_type`, `provider`, `model`, `prompt_version`, `input_hash`, `output`, `usage`, `status`, `created_at` | 每次 AI 抽取、分類、比對或回答輔助的可審計紀錄 |
| `extraction_candidates` | `id`, `raw_asset_id`, `ai_run_id`, `candidate_type`, `payload`, `confidence`, `status`, `created_at` | AI 產生的術語、Claim、版本、品質或去重候選；未審前不可進正式表 |

`claims.statement` 應是一句可完整驗證的敘述，不應只是零散標籤。例如「Java 1.21+ 原版中，漏斗成功傳輸後通常設定 8gt 冷卻；特定時序條件下可能為 7gt」。

建議狀態：`pending`、`approved`、`rejected`、`deprecated`、`disputed`。

建議可信度：`documented`、`expert_reviewed`、`measured`、`inferred`、`unverified`。

Claim 的向量索引應以 `claims.id` 關聯，與文件 Chunk 向量索引分開保存與檢索。

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

1. 建立或確認 `source`，建立可追溯的 `import_run`。
2. 保存原始內容、編碼、邏輯記錄號與 SHA-256 `content_hash` 至 `raw_assets`。
3. 同一來源、同一路徑、同一雜湊的內容不重複匯入，但保留匯入紀錄。
4. 先以確定性規則標記 404、空內容、導航、重複、錯誤連結與格式錯誤。
5. 再解析文件結構、術語、版本提示與 AI 候選；AI 結果保存至 `ai_runs` 與 `extraction_candidates`。
6. 僅將通過品質門檻的內容分流為 term、document、chunk 或 community note。
7. 匯入資料預設進入 `pending` 或依來源政策決定狀態。
8. 僅在人工審核後進入 Answer Index；原始資料與被拒絕資料仍可追溯但不索引。

Raw 區的內容、QQ 使用者 ID、群組 ID、原始附件解析文字與原始模型輸出永久保存，但只能由知識審核白名單讀取。公開回答、引用、來源網站與向量索引不得輸出或索引這些原始識別資訊；社群來源預設顯示「社群整理」，只有原始貢獻者明確選擇公開署名時才可顯示名稱。

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
| 文件全文索引 | SQLite FTS5 / BM25，索引 `document_chunks` | 精確段落、版本號、機制名稱與文件用語 |
| 術語全文索引 | SQLite FTS5 / BM25，索引 `terms`、`term_aliases`、`term_translations` | 中英名稱、縮寫、社群俗稱與翻譯展開 |
| 文件 Chunk 向量索引 | Sentence-BERT Embedding，關聯 `document_chunks.id` | 從原始文件找語意相近且可引用的證據段落 |
| Verified Claim 向量索引 | Sentence-BERT Embedding，關聯 `claims.id` | 從已審核結論找直接可用的技術敘述 |
| Metadata 篩選 | SQLite 條件查詢 | 狀態、版本、平台、來源可信度 |

文件 Chunk 與 Claim 的向量不得混在同一個索引。兩者的資料可信度、粒度與用途不同：Chunk 是原始證據，Claim 是經審核的結論。查詢時應各自取候選，再由 Evidence Workspace 依版本、狀態與問題類型合併。

向量索引採持久化 `sqlite-vec`，不以程序記憶體作為索引真源。至少建立兩個獨立的 `vec0` 虛擬表：`document_chunk_vectors` 關聯 `document_chunks.id`，`claim_vectors` 關聯 `claims.id`。每筆索引中繼資料必須保存 `model_name`、`dimension`、`normalized`、`content_hash`、`indexed_at` 與 `index_version`；內容雜湊、模型或索引版本變更時，僅重算受影響條目。

### Query Planner

收到問題後，先嘗試辨識：

1. 目標：定義、機制解釋、設計比較、故障排查、機器推薦或效能分析。
2. Minecraft 範圍：Java/Bedrock、版本、Vanilla/Fabric/Paper 等。
3. 涉及術語及其別名。
4. 缺少但會影響結論的條件。

版本或平台不可推定時，回答應明確說明採用的假設，或優先詢問使用者補充。

### Hybrid Retrieval

1. 以術語別名展開查詢。
2. 以術語 FTS5 找出精確概念與別名對應。
3. 對已核准的文件 Chunk 執行 FTS5/BM25 與 Chunk 向量搜尋。
4. 對已核准 Claim 執行獨立的 Claim 向量搜尋。
5. 使用版本、環境、狀態與可信度過濾或降權。
6. 分別合併文件候選與 Claim 候選，再依問題類型建立證據工作區。
7. 重排序時提高「術語精確命中、版本相容、已核准、直接回答問題」的權重。
8. 對複雜問題選取多個互補證據，而不是只取單一最高分段落。

### 審核模式與試用模式

正式回答預設為 `approved_only`，只檢索 `approved` 資料。管理者可透過集中設定切換為 `include_pending`，在審核作業開始前試用待審資料的回答效果。

| 模式 | 可檢索資料 | 回答規則 |
| --- | --- | --- |
| `approved_only` | `approved` | 正式預設模式 |
| `include_pending` | `approved` + `pending` + `legacy_review` | 回答必須逐項標示待審來源，並聲明其不可視為已驗證事實 |

此設定只能由管理者修改，且應在 `src/config.ts` 集中定義。切換模式不改變任何資料的審核狀態，也不能使待審內容自動升格。

試用模式由 QQ 管理命令 `/knowledge mode approved` 或 `/knowledge mode pending` 持久化切換。設定值存於 `knowledge_settings`，每次切換須寫入 `knowledge_setting_audit`，記錄操作人、舊值、新值與時間。只有知識審核白名單可執行此命令。`include_pending` 開啟時，只有明確列於 `QQ_GROUP_WHITELIST` 的群組使用者可收到帶待審警示的回答；若一般群組白名單留空，pending 對所有群組停用。非群組消息不使用 pending 資料。

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

---

# Plan

本區塊將上述設計展開為可執行的順序流程。每個 Phase 內拆分為 Track，Track 是最小的可獨立開工單位，同一批次內的 Track 之間無依賴，可同時進行。

## 使用方式

| 項目 | 約定 |
| --- | --- |
| Track 編號 | `T<phase>.<n>`，橫向貫穿性工作為 `TX.<n>` |
| 分支對應 | 一個 Track = 一個分支 = 一個 PR，符合「每個 PR 只處理一件明確的事情」 |
| 批次 | 同一批次內的 Track 無互相依賴，可平行開工 |
| 關卡 | 批次之間的凍結點；關卡未通過不得開始下一批次 |
| 狀態 | 未開始 / 進行中 / 待審 / 完成 |

## 資料盤點實測結果

以下為實際讀取檔案後的數據，作為各 Track 完成條件的基準值。

| 來源 | 實測量 | 備註 |
| --- | --- | --- |
| `database.json` | 81 筆機器、228 個 tag、`sub_id` 81/81 唯一 | 欄位 `id,name,author,tags,description,preview,filename,sub_id` |
| `dictionary/entries/` | 112 個詞條檔 | 含 `id,terms,definition,threadURL,status,references,referencedBy,updatedAt`；`summary` 位於 `dictionary/config.json` |
| `gtmc-database/` | 23 個 Markdown 檔 | 19 份內容與 `database.csv` 逐字重複；含 404、導航與未完成文件 |
| `TechMC Glossary.csv` | 415 列、25 欄多語 | 欄名為 `Category,Short Form,Regex,Full Form (English),Related,Description` + 11 語系；檔首含 BOM |
| `database.csv` | 151 筆 RFC 4180 邏輯記錄、4,288 個實體行 | 19 筆多行 Markdown 佔大量實體行；不可按換行解析 |
| `database.md` | 215 行 | |
| `Dictionary.txt` | 117 行 | |

## 已確認的現行缺陷

進入遷移前需登記的既有問題，避免遷移時將錯誤一併帶入。

| 編號 | 問題 | 影響 | 處理 Track |
| --- | --- | --- | --- |
| D1 | `loadGlossary()` 取 `term`/`definition` 欄位，但 CSV 實際無此欄名，415 列全部映射為空字串 | 詞彙表對回答完全無貢獻；每次 `/ask` 對 415 筆空內容做 embedding | T0.3 登記、T2.7 修正 |
| D2 | 每次 `/ask` 重建整個知識庫向量索引 | 延遲隨資料量線性惡化 | T4.2、T4.6 |
| D3 | 自動學習不受 `QQ_LEARN_WHITELIST` 限制，直接寫入被全體使用者檢索的知識庫 | 未審核內容污染正式回答 | T3.6、T3.8 |
| D4 | 附件下載無網域白名單，與 `submissions/download.ts` 的 SSRF 防護標準不一致 | 防禦深度不一致 | TX.4 |
| D5 | 知識寫入無去重、無來源、無法修正 | 知識庫單向膨脹且不可維護 | T3.1、T3.9 |
| D6 | `database.csv` 將術語翻譯、社群知識、完整 GTMC 文件混為 `topic,content`；19 份 GTMC 文件與原目錄逐字重複 | 重複向量、來源遺失、長文被錯當單一知識 | T0.5、T2.4、T3.4 |
| D7 | GTMC 含 404、空序言、純導航、僅提綱與失效相對連結 | 無效內容會被誤檢索為技術證據 | T0.5、T2.4 |
| D8 | CSV 含拼寫錯誤、同義詞重複、混合多概念與衝突事實 | 直接遷移會把錯誤固化為知識 | T0.5、T2.6、T3.5 |

## 前期資料清理與分流

SQLite 遷移不是搬檔案。所有舊資料先進 `raw_assets`，再依下列規則分流；「移除」只代表不進正式知識與索引，不刪除原始快照。

| 來源情況 | 處理 | 目標資料 |
| --- | --- | --- |
| GTMC 合格技術文章 | 保留原文件、依標題切 chunk；結構解析後以 AI 補充內容品質、版本與 Candidate Claim，記錄品質結果 | `documents`、`document_chunks`、`extraction_candidates` |
| GTMC 404、空序言、純目錄、僅提綱、失效連結文件 | 建立品質旗標，不建立可檢索 chunk | `raw_assets`、`content_quality_flags` |
| CSV 中與 GTMC 完全相同的 19 份長文 | 不重複建立文件或向量，只建立來源追溯關係 | `raw_assets`、provenance 關聯 |
| CSV 中短術語、中英翻譯、縮寫 | AI 比對 dictionary/Glossary 後，建立 alias 或 translation 候選 | `extraction_candidates` |
| CSV 中有獨立價值的社群解釋 | AI 整理為結構化 community note 或 Claim 候選 | `extraction_candidates` |
| CSV 中拼寫錯誤、同義重複、混合兩個概念、衝突事實 | 標記品質問題並建立修正或拆分候選，不直接進索引 | `content_quality_flags`、`extraction_candidates` |

`database.csv` 的全部 151 筆邏輯記錄一開始只能進 `raw_assets`，不得直接寫入 `knowledge_entries`、`terms`、`term_aliases`、`term_translations` 或 `claims`。確定性規則先處理雜湊重複、空內容、404、導航與格式錯誤；AI 再判斷「短記錄是術語、社群筆記或錯誤」、「兩個詞是否為同義」、「長文是否具足夠正文」、「內容應拆成幾個 Candidate Claim」。

AI 必須輸出可驗證的結構化候選，至少包含 `candidate_type`、`normalized_title`、`normalized_content`、`term_refs`、`source_raw_asset_id`、`quality_flags`、`confidence` 與 `rationale`。候選先存入 `extraction_candidates`；通過 JSON schema、來源回鏈與品質規則後，系統自動 materialize 為 `pending` 的術語、知識或 Claim。`include_pending` 模式只可使用這些已結構化的 pending 項目，不能直接檢索 CSV 原文；任何候選都不得自動成為 `approved`。

## 里程碑總覽

| Phase | 目標 | Track 數 | 關鍵產出 |
| --- | --- | --- | --- |
| 0 | 資料政策、盤點與清理規則 | 5 | 枚舉契約、來源政策、清理清單、評測題庫 |
| 1 | SQLite 基礎與機器遷移 | 8 | DB 基礎設施、`machines`、Raw 目錄遷移與增量掃描 |
| 2 | 文件與術語遷移 | 10 | `documents`、`terms`、切段器 |
| 3 | 知識與 Claim 審核 | 9 | `knowledge_entries`、`claims`、審核流程 |
| 4 | 混合檢索 | 6 | FTS5、向量版本化、RRF |
| 5 | 證據式回答與來源目錄 | 6 | Evidence Workspace、引用、來源網站介面 |
| 6 | 實驗資料 | 3 | `experiments` |

---

## Phase 0：資料政策與盤點

目標：凍結所有後續 Track 共用的介面契約，避免平行開工後因定義不一致而返工。

### 批次 0-A（可同時開工）

| Track | 內容 | 依賴 | 產出 | 完成條件 |
| --- | --- | --- | --- | --- |
| T0.0 | AI 模型設定：在 `src/config.ts` 定義 `DEEPSEEK_MODEL_FLASH = 'deepseek-v4-flash'` 與 `DEEPSEEK_MODEL_PRO = 'deepseek-v4-pro'`，AI 服務以明確模型角色呼叫 | 無 | 集中模型設定與型別安全選擇介面 | 所有 AI 呼叫明確選擇 Flash 或 Pro；不得再使用單一 `DEEPSEEK_MODEL` |
| T0.1 | 來源政策：定義 `sources.type` 分類、`trust_level` 分級、各來源的 `license` 與 `url` | 無 | 政策表（寫回本文件） | 7 類現有資料每一項都有明確 type / trust_level / license |
| T0.2 | 狀態與可信度枚舉定案 | 無 | `src/db/enums.ts` | `status` 與 `confidence` 常數為全專案唯一真源，不得散落字串字面值 |
| T0.3 | 資料盤點與缺陷登記 | 無 | 盤點報告（已完成大部分，見上表） | 每個來源的實際欄位、筆數、編碼、異常皆登記；D1-D8 有指派 Track |
| T0.4 | 評測題庫建立（30-50 題，涵蓋 7 種類型） | 無 | `eval/questions.json` | 題目涵蓋術語定義、別名、版本限制、多證據推理、機器推薦、衝突處理、拒答 |
| T0.5 | 清理與分流規則：為既有 CSV／GTMC 建立可重複執行的品質分類、去重與保留策略 | 無 | `docs/data-triage.md`、fixture | CSV 以 RFC 4180 解析為 151 筆邏輯記錄；19 份重複 GTMC 僅保留 provenance；404、空白、純導航、僅提綱、失效連結、術語重複與衝突事實都有明確去向 |

### 關卡 G0

- `enums.ts` 已合併，後續所有 schema Track 直接引用。
- 來源政策已定案，`license` 欄位不再有待確認項。
- 評測題庫已存在（Phase 1 的回歸基準需要它）。
- 清理規則已經在小樣本與完整 CSV／GTMC 上驗證；不允許「原樣搬入 SQLite」作為遷移方案。

### Phase 0 已確認政策

| 主題 | 決策 | 對實作的約束 |
| --- | --- | --- |
| GTMC 授權 | `CC BY-NC-SA 4.0` | 每次使用 GTMC 證據的回答需列來源 ID、作品／文章名稱與作者或署名對象；找不到作者時留空；來源網站須展示完整授權與修改標記 |
| 詞典授權 | `GPL-3.0-or-later` | 來源目錄保留原始來源連結、著作權聲明與授權資訊 |
| 機器投稿 | 僅用於機器推薦 | 投稿者已同意 OpenST 投稿條款；Bot 顯示既有 OpenST 檔案庫連結，不建立額外來源目錄條目 |
| TechMC Glossary | 來源與授權待提供 | 取得 URL、作者與再散布條件前，僅可內部檢索與審核，不進公開來源網站 |
| 社群 Raw 證據 | 永久保存，但僅 Raw 區完整保存 | 原始 QQ ID、群組 ID、訊息與附件文字不可進公開來源、索引或一般回答 |
| 社群公開署名 | 預設匿名 | 公開回答與來源網站顯示「社群整理」；僅明確同意時顯示貢獻者名稱 |
| 審核權限 | `/review` 與 `/judge` 各自獨立使用者與群組白名單 | 新增 `KNOWLEDGE_REVIEWER_USERS`、`KNOWLEDGE_REVIEWER_GROUPS`、`KNOWLEDGE_JUDGE_USERS`、`KNOWLEDGE_JUDGE_GROUPS`；使用者或群組任一命中即具備身份，不可沿用投稿審核者作隱性預設 |
| 試用模式 | QQ 管理命令持久切換 | 模式值與切換稽核存 SQLite；僅知識審核者可切換 |
| SQLite 備份 | 本期暫不實作 | Phase 1 僅記錄風險與 DB 路徑；後續另立備份 Track |
| SQLite 路徑 | `public/database/knowledge.db` | 第一版不加入 gitignore；後續可加環境變數覆蓋與備份策略 |
| 啟動匯入 | migration 後掃描 Raw 目錄與機器 JSON | Raw 以 manifest 比對未匯入或雜湊已改變檔案並自動增量匯入；`database.json` 雜湊變更時直接同步 machines，不經 AI |
| AI API | Flash／Pro 共用現有 API，均支援 JSON | 僅 API Key 讀環境變數；模型 ID 以集中常數 `DEEPSEEK_MODEL_FLASH`、`DEEPSEEK_MODEL_PRO` 定義；不納入費率與配額處理 |
| 來源網站 | Bot 輸出固定來源 URL；網站可為靜態網站 | 對外來源 ID 採 `SRC-00000001` 全域流水號，每個可引用 Chunk 一個 ID；首次建立後永不改變或重用；橋接層可另行匯出公開投影，Raw 區不可公開 |
| 網站來源對照 | Bot 只維護本地來源與 ID 對照表 | 產生不含 Raw 正文與 QQ 資訊的 `source-id-map.json`；網站完全獨立，可自行抓取完整來源後按 `SRC-*` 對應 |
| 歷史 CSV／Markdown 與社群內容 | Raw 僅內部保存；整理核准後公開 | 每個整理後可引用 Chunk 保留 `SRC-*`；公開網站只輸出核准後的整理內容與匿名「社群整理」署名，不輸出 Raw、QQ ID 或群組 ID |
| 社群整理公開條款 | OpenST 自訂內容條款 | 公開投影須連至條款 URL；條款內容與 URL 提供前，不發布新社群整理來源頁 |
| 回覆判定 | 正確、錯誤、部分正確、修改建議 | 部分正確須拆分知識點逐項判定；修改建議建立待審修訂候選 |

### Phase 0 實作規格

#### T0.1 來源政策

**目的**：建立唯一的來源登錄清單，讓每個匯入器在寫入前就知道資料是否可公開、如何署名及是否需要阻擋公開投影。

**產出**：`docs/source-policy.md`。每個來源一列，欄位固定為 `source_key`、`type`、`display_name`、`creator`、`origin_url`、`license`、`license_url`、`visibility_default`、`attribution_rule`、`public_export_rule`、`status`。

**初始來源清單**：

| source_key | visibility_default | 公開規則 |
| --- | --- | --- |
| `gtmc` | `public` | 必須顯示作品／文章名稱、可得作者、原始 URL、CC BY-NC-SA 4.0 與修改標記 |
| `storage_tech_dictionary` | `public` | 顯示來源與 GPL-3.0-or-later 資訊 |
| `techmc_glossary` | `internal` | 等待來源與授權確認後才可改為 `public` |
| `openst_machine_submission` | `internal` | 僅機器推薦使用，連至既有 OpenST 檔案庫，不建立來源目錄頁 |
| `legacy_database_csv` | `internal` | 只作 Raw 與 AI 整理來源；核准整理內容以 `openst_community` 發布 |
| `legacy_database_markdown` | `internal` | 只作 Raw 與 AI 整理來源；核准整理內容以 `openst_community` 發布 |
| `openst_community` | `internal` | OpenST 公開條款 URL 未設定前不可公開投影；公開時預設署名「社群整理」 |

**驗收**：匯入器不得在程式中硬編碼授權、作者或 visibility；所有值必須由政策表或資料庫 `sources` 取得。缺少 `license` 或 `public_export_rule` 的 public 來源必須拒絕公開匯出，但可保存 Raw。

**外部阻擋**：TechMC Glossary 的來源／授權，以及 OpenST 公開條款 URL。

#### T0.2 枚舉與狀態轉移

**目的**：將不同層次的狀態拆開，禁止以一個模糊欄位同時表達審核、公開性與品質。

`src/db/enums.ts` 必須匯出下列只讀常數與 TypeScript union type：

| 類別 | 合法值 |
| --- | --- |
| 審核狀態 | `pending`, `approved`, `rejected`, `deprecated`, `disputed`, `legacy_review` |
| 公開性 | `internal`, `public` |
| 候選狀態 | `generated`, `materialized`, `rejected`, `superseded` |
| 品質旗標 | `empty`, `stub`, `navigation`, `not_found`, `broken_link`, `duplicate_exact`, `duplicate_near`, `mixed_concepts`, `possible_typo`, `conflicting_fact`, `license_unknown` |
| AI 任務 | `csv_triage`, `gtmc_quality`, `term_normalize`, `claim_extract`, `query_plan`, `answer_split`, `feedback_classify`, `conflict_review`, `answer_synthesis` |
| 回答判定 | `correct`, `incorrect`, `partial`, `amend` |

狀態機最小規則：`pending -> approved|rejected|deprecated|disputed`；`approved -> deprecated|disputed`；`rejected` 不得直接回 `approved`，必須建立新候選或明確修訂紀錄。`legacy_review` 只能由審核者轉為 `approved`、`rejected` 或 `deprecated`。

**驗收**：禁止在業務程式以任意字串寫入以上欄位；每個非法轉移必須回傳可讀錯誤並保持 DB 不變。

#### T0.3 可重現資料盤點

**目的**：把目前的人工檢查變成可重跑的基準，而非文件中的一次性數字。

**產出**：`scripts/audit-knowledge-data.ts` 與 `docs/data-audit.json`。稽核器必須使用 RFC 4180 parser 讀取 CSV，輸出邏輯記錄數、跨行記錄數、空欄位、重複雜湊、與 GTMC 的精確重複、詞典／Glossary 精確術語重疊、Markdown 類型與失效連結。

**基準斷言**：CSV 為 151 筆邏輯記錄；GTMC 為 23 份 Markdown；CSV 與 GTMC 有 19 份精確重複。數字改變時稽核器不可靜默通過，必須輸出差異報告供審核。

#### T0.4 評測題庫

**產出**：`eval/questions.json`。每題必須包含：

```text
id, category, question, edition, version, environment,
expected_terms, expected_source_ids, forbidden_source_ids,
expected_answer_properties, expected_uncertainty, status
```

`expected_answer_properties` 不存固定自然語言答案，而存可評測條件，例如「區分 BED 與解碼」、「說明版本前提」、「不得引用導航頁」、「必須承認資料不足」。每題需至少一名審核者標記 `approved` 才能成為回歸基準。

#### T0.5 清理與 AI 分流

**確定性前置規則**：

1. CSV 僅以 RFC 4180 parser 讀取；禁止按換行切割。
2. 空內容、404、純導航、僅目錄、僅標題、失效連結先建立品質旗標。
3. 檔案雜湊精確重複時，保留 Raw，但只選一個 canonical source；CSV 中 19 份 GTMC 副本只能建立 provenance。
4. 已知術語的大小寫、空白與括號格式只可正規化為比對鍵，不可改寫 Raw 原文。
5. 部分完成文件只保留已完成段落；標示「暫未完成」的段落建立 `stub` 旗標且不切入索引。
6. 文字正文完整但圖片或相對連結失效時，保留正文與 Chunk，建立 `broken_link` 旗標；不刪除原始連結語法。

**Flash 的 `csv_triage` 結構化輸出**：每個非重複 CSV 邏輯記錄輸出 `candidate_type`（`term`, `community_note`, `claim`, `discard`, `needs_review`）、正規化標題與正文、引用的 Raw ID、相關 term 候選、品質旗標、理由與信心值。輸出必須通過 JSON schema；無法判斷或含衝突事實時輸出 `needs_review`，不得猜測。

**Pro 的介入條件**：只有 `conflicting_fact`、`mixed_concepts`、跨多個 GTMC／詞典來源或 Flash 無法分類的項目，才使用 Pro 產生比較報告與 Candidate Claim。Pro 輸出仍只是 `extraction_candidate`。

**materialize 規則**：候選具有有效 Raw 回鏈、合法 JSON、非空正文且未帶阻擋品質旗標時，自動建立 `pending` 項目。`discard`、`not_found`、`navigation`、`stub`、`duplicate_exact` 不 materialize。`possible_typo`、`mixed_concepts`、`conflicting_fact` 只建立 `needs_review` 型候選，不可 materialize 為 pending 或進 Answer Index。

**驗收**：清理作業必須輸出每個 Raw ID 的唯一結果：`provenance_only`、`candidate`、`pending` 或 `excluded`，並可由報告追溯原因、規則版本與 AI run ID。

**AI 驗收策略**：採「錄製 AI JSON Fixture + 規則層自動測試」。即時 Flash／Pro 只對新 Raw 資料產生候選；已確認的 CSV、GTMC、`/learn` 範例將其結構化輸出保存為 Fixture。回歸測試不呼叫即時模型，而是重播 Fixture，驗證 JSON schema、Raw 回鏈、品質旗標、materialize、去重、審核狀態與 Answer Index 隔離。規則層測試另需驗證：即使收到未知或不合法 AI JSON，也不能讓資料跳過 pending 直接進 `approved`。

**Fixture 檔案**：

```text
eval/fixtures/triage/
  csv-expected.json
  gtmc-expected.json
  duplicate-provenance.json
  ai-responses/
    csv-triage/<raw-content-hash>.json
    gtmc-quality/<raw-content-hash>.json
    conflict-review/<raw-content-hash>.json
```

`csv-expected.json` 的每筆資料固定包含：

```text
logical_record_no, topic, raw_content_hash, expected_outcome,
expected_candidate_type, required_flags, forbidden_flags,
canonical_source_path, expected_term_aliases, notes
```

`gtmc-expected.json` 的每筆資料固定包含：

```text
source_path, raw_content_hash, document_outcome,
expected_completed_headings, excluded_headings,
required_flags, broken_links, public_visibility, notes
```

`duplicate-provenance.json` 固定列出 CSV 邏輯記錄與 canonical GTMC 檔案的對應：

```text
csv_logical_record_no, canonical_source_path, duplicate_hash, relation
```

其中 `relation` 在本期只允許 `exact_duplicate`。Fixture 必須涵蓋全部 151 筆 CSV 邏輯記錄與全部 23 份 GTMC Markdown；任何未列入 Fixture 的輸入都使稽核失敗。新增或變更來源時，必須先更新 Fixture 並經知識審核者核准。

AI 回覆 Fixture 的檔名使用輸入 Raw 內容的 SHA-256，不使用模型生成的標題。每份 Fixture 必須包含 `task_type`、`model`、`prompt_version`、`input_hash`、`response`、`approved_by`、`approved_at`。模型升級或 prompt 變更時，舊 Fixture 不覆蓋；以新版本檔案並列保存，並由評測題庫明確指定採用哪個版本。

---

## Phase 1：SQLite 基礎與機器遷移

目標：建立 DB 基礎設施並完成第一張表的完整遷移，作為後續所有表的樣板。

### 批次 1-A（基礎設施，阻斷後續全部）

| Track | 內容 | 依賴 | 產出 | 完成條件 |
| --- | --- | --- | --- | --- |
| T1.1 | DB 連線與 migration 機制：`better-sqlite3` 單例、WAL、固定路徑 `public/database/knowledge.db`、可重複執行的 schema runner、版本化 migration | G0 | `src/db/connection.ts`、`src/db/migrate.ts` | 刪除 DB 檔後重啟可自動重建；migration 可重複執行不報錯；本期 DB 檔不加入 gitignore |

### 批次 1-B（可同時開工）

| Track | 內容 | 依賴 | 產出 | 完成條件 |
| --- | --- | --- | --- | --- |
| T1.2 | `sources`、`import_runs`、`raw_assets`、`content_quality_flags`、`ai_runs`、`extraction_candidates`、`source_references` 表與來源註冊工具 | T1.1 | schema、`registerSource()`、raw snapshot 工具 | 同雜湊不重複匯入；每個可引用 Chunk 的對外 ID 採 `SRC-00000001` 全域序號，首次建立後永久不變且永不重用；pending 的 ID 已保留但不進公開投影；來源、原始內容、編碼、品質旗標與 AI 候選均可查詢 |
| T1.3 | `machines` / `machine_tags` / `machine_terms` / `machine_relations` 建表 | T1.1 | schema 檔 | 後兩張表建立但本階段不寫入，避免日後破壞性遷移；機器資料不建立 `source_references`，維持既有 OpenST 檔案庫連結 |
| T1.5a | **遷移前**基準快照：對評測題庫的機器推薦類問題執行現行 `searchMachines()`，記錄各題 top-5 `sub_id` 順序 | T0.4 | `eval/baseline-machines.json` | 必須在 T1.4 改動程式碼**之前**完成 |

### 批次 1-C

| Track | 內容 | 依賴 | 產出 | 完成條件 |
| --- | --- | --- | --- | --- |
| T1.2b | Raw 目錄遷移：直接移動現有原始資料至 `public/database/raw/`，並同步更新尚未遷移的舊讀取路徑 | T1.2 | Raw 目錄結構與暫時相容路徑 | `gtmc-database/`、`dictionary/`、`TechMC Glossary.csv`、`database.csv`、`database.md`、`Dictionary.txt` 全數移入 Raw；`database.json` 留在原位；`npm run build` 通過且既有命令不因路徑變更失效 |
| T1.4a | `database.json` 機器同步器：每次啟動以 SHA-256 偵測你在本機手動更新的 JSON，單一 transaction、`ON CONFLICT(sub_id) DO UPDATE`、tag 差異同步 | T1.2, T1.3 | `src/db/import/machines.ts` | 匯入後 `machines`=81、`sub_id` 唯一=81、`machine_tags`=228；JSON 未變更時不寫 DB；變更時直接同步且不呼叫 AI；已被人工改為非 `approved` 的 `status` 不被重匯入覆寫；不納入 Raw 目錄掃描器 |

### 批次 1-D

| Track | 內容 | 依賴 | 產出 | 完成條件 |
| --- | --- | --- | --- | --- |
| T1.2a | Raw 目錄增量掃描器：掃描與監看本機 `public/database/raw/`，讀取／更新 `import-manifest.json`，只派送新增或 SHA-256 改變的檔案至匯入管線 | T1.1, T1.2, T1.2b | `src/db/import/rawScanner.ts`、`public/database/raw/import-manifest.json` | Bot 啟動時 migration 後自動執行；本機檔案變更後自動增量掃描；未變更檔案不重複派送；manifest 記錄相對路徑、雜湊、最後匯入時間、import run ID 與結果；同一時間只允許一個掃描／匯入作業；不提供 QQ 手動觸發命令 |
| T1.4b | `services/data.ts` 改接 SQLite，對外型別與呼叫端零改動 | T1.4a | 改寫後的 `loadMachineDatabase()` | `MachineEntry[]` 介面不變；`searchMachines()` 不需修改 |

### 批次 1-E

| Track | 內容 | 依賴 | 產出 | 完成條件 |
| --- | --- | --- | --- | --- |
| T1.5b | 回歸驗證：重跑基準快照並逐題比對 | T1.4b, T1.5a | 比對報告 | 每題 top-5 `sub_id` 順序與 T1.5a 完全一致 |
| T1.6 | 收尾：Raw 目錄與 manifest 的檔案政策、啟動／檔案監看匯入說明、AGENTS.md 資料檔說明 | T1.2a | 設定與文件 | `knowledge.db` 提交 Git；`knowledge.db-wal`、`knowledge.db-shm` 與 Raw manifest 加入 gitignore；不提供 QQ 或 npm 手動同步入口；文件說明本機檔案異動會自動觸發相同掃描器 |

Raw 目錄固定結構：

```text
public/database/
  database.json
  knowledge.db
  raw/
    gtmc-database/
    dictionary/
    TechMC Glossary.csv
    legacy/
      database.csv
      database.md
      Dictionary.txt
    import-manifest.json
```

T1.2b 僅搬移原始資料與更新暫時相容讀取路徑；不得在此 Track 對 CSV、GTMC 或詞典內容做清理、AI 改寫或資料語意變更。

### 關卡 G1

- 計數斷言全部通過（81 / 81 / 228）。
- 推薦行為零回歸。
- 手動置換 `database.json` 後重啟，DB 直接自動同步且不呼叫 AI。

---

## Phase 2：文件與術語遷移

目標：把文件、術語、版本範圍納入 DB，使中英文與縮寫可命中同一概念並追溯來源。

### 批次 2-A（schema 與純函式，全部可同時開工）

| Track | 內容 | 依賴 | 產出 | 完成條件 |
| --- | --- | --- | --- | --- |
| T2.1 | `documents` / `document_versions` / `document_chunks` 建表 | G1 | schema | 文件修訂保留歷史，不覆蓋 |
| T2.2 | `terms` / `term_aliases` / `term_translations` / `term_relations` / `term_evidence` 建表 | G1 | schema | |
| T2.3 | Markdown 解析與切段器（純函式，無 DB 依賴） | G1 | `src/db/import/markdown.ts` | 依 `#`~`######` 建 `heading_path`；不在定義、條件、列表中間硬切；表格保留欄列關係；code block 保留原文與語言標記；每個 chunk 可回鏈標題位置 |
| T2.10 | `version_scopes` / `content_version_scopes` 建表與標註工具 | G1 | schema + 工具 | 未知版本標為 `unknown`，不得假裝適用全版本 |

### 批次 2-B（各來源匯入器，互相獨立可同時開工）

| Track | 內容 | 依賴 | 產出 | 完成條件 |
| --- | --- | --- | --- | --- |
| T2.4 | `gtmc-database/` 23 檔分流匯入：先建 raw snapshot，再依 T0.5 排除 404、空白、導航、僅提綱；部分完成文件只保留完成段落，失效資源只標記；合格內容才建立 `documents` + `document_chunks`，並以 AI 產生內容品質、版本與 Claim 候選 | T1.2, T2.1, T2.3, T0.5 | 匯入器、AI 任務與品質報告 | 23 檔全數有 raw snapshot、確定性分類與 AI 候選；完成 chunk 可回溯檔案與標題路徑；`stub` 不進索引，`broken_link` 正文保留並帶旗標 |
| T2.5 | `dictionary/` 匯入：`entries/*.json` 的 `definition`、來源 URL、審核狀態與引用關係；`config.json` 的 `summary`；`zh-translations.json` 的中文翻譯 | T2.2 | 匯入器 | 112 詞條全數匯入；英文原始定義、中文定義與來源連結皆可追溯；僅既有 `APPROVED` 詞條標為 `approved` |
| T2.6 | 術語清理候選：`Dictionary.txt` 可直接作翻譯候選；CSV 中短術語必須先經 AI 正規化為 `extraction_candidates`，辨識拼寫錯誤、同義詞、雙向別名及多概念混合記錄 | T1.2, T2.2, T0.5 | 匯入器與候選清單 | 不覆蓋 T2.5 正式翻譯；CSV 不直接寫入術語表；`Flitered`、`Paraller Codes`、`Singal Strength` 等只作待審更正候選；多概念記錄不作單一術語入庫 |
| T2.7 | `TechMC Glossary.csv` 欄位重新映射與匯入（修正缺陷 D1） | T2.2 | 匯入器 | 415 列正確映射至 `Short Form` / `Full Form (English)` / `Chinese` / `Description (Chinese)` 等欄；處理 BOM；非空條目數 > 0 且與人工抽樣一致；授權待確認前強制 `visibility=internal` |
| T2.8 | `database.md` 215 行匯入為 `pending` 文件 | T2.1, T2.3 | 匯入器 | 作為 `database.csv` 的追溯來源，不直接成為 Claim |

### 批次 2-C

| Track | 內容 | 依賴 | 產出 | 完成條件 |
| --- | --- | --- | --- | --- |
| T2.9 | 術語別名查詢服務 + `services/dictionary.ts` 改接 DB | T2.5, T2.6, T2.7 | `src/services/terms.ts` | `Block Update Detector` / `BUD` / `方块更新检测器` / `方塊更新檢測器` 命中同一 `terms.id` |

### 關卡 G2

- 中文、英文、縮寫三種輸入可命中同一概念並列出來源。
- 缺陷 D1 已消除，詞彙表對回答有實際貢獻。

---

## Phase 3：知識與 Claim 審核

目標：建立 Human-in-the-Loop 閘門，確保未審核內容不進入正式回答。此階段同時修正缺陷 D3、D5。

### 批次 3-A（schema，可同時開工）

| Track | 內容 | 依賴 | 產出 | 完成條件 |
| --- | --- | --- | --- | --- |
| T3.1 | `knowledge_entries` / `knowledge_terms` 建表，含去重雜湊、來源、建立者欄位 | G2 | schema | |
| T3.2 | `claims` / `claim_conditions` / `claim_exceptions` / `claim_evidence` / `claim_relations` 建表 | G2 | schema | |
| T3.3 | `reviews` / `answer_feedback` / `answer_feedback_items` / `knowledge_settings` / `knowledge_setting_audit` 建表與審核狀態機 | G2 | schema + 狀態轉移規則 | 合法轉移明確定義，非法轉移被拒絕；回饋可連回問題、回答與證據快照；模式切換可追溯 |

### 批次 3-B

| Track | 內容 | 依賴 | 產出 | 完成條件 |
| --- | --- | --- | --- | --- |
| T3.8 | 審核模式切換口：集中設定 `approved_only` / `include_pending`，並在檢索結果保留資料狀態 | T3.1 | 檢索設定與狀態標記 | 預設 `approved_only`；只有管理者可切換；`include_pending` 僅對明確 `QQ_GROUP_WHITELIST` 群組生效且回答必帶待審警示 |
| T3.4 | `database.csv` AI 整理管線：以 RFC 4180 讀取 151 筆邏輯記錄，全部先進 `raw_assets`；GTMC 副本建立 provenance，其他內容由 AI 產生結構化候選，再 materialize 合格候選為 `pending` | T1.2, T2.4, T2.6, T3.1, T0.5 | 匯入器、AI 任務與清理報告 | 19 份 GTMC 副本只連結原 GTMC document；CSV 原文零筆直接進正式表；每個可試用項目皆有 `ai_run`、原始記錄回鏈、品質旗標與候選理由；`include_pending` 僅使用 materialize 後的 pending 項目 |

### 批次 3-C（寫入路徑改造，可同時開工）

| Track | 內容 | 依賴 | 產出 | 完成條件 |
| --- | --- | --- | --- | --- |
| T3.5 | 審核入口優先：pending 清單、詳情、通過／拒絕按鈕與 `/knowledge mode approved|pending`，複用 `submissions` 既有鍵盤模式 | T3.3 | `src/commands/review.ts`、`src/commands/knowledge.ts` | 使用者符合 `KNOWLEDGE_REVIEWER_USERS` 或所屬群符合 `KNOWLEDGE_REVIEWER_GROUPS` 時可查看來源、版本、條件、例外與證據後決策或切換模式；入口在任何寫入路徑切換前可用 |
| T3.6 | `/learn` 改寫入 SQLite，帶來源、建立者、去重與待審狀態 | T3.1, T3.3, T3.5 | 改寫後的 `commands/learn.ts` | 不再 append CSV；相同內容建立可追溯重複關聯或提示，不覆蓋既有來源與建立者 |
| T3.7 | 主動與被動自動學習改為只能建立 `pending`，保留原始訊息、附件摘要與 AI 提取結果（修正 D3） | T3.1, T3.5 | 改寫後的 `services/learn.ts` | 自動學習在任何情況下都不能產生 `approved`；被動學習提取器必含原問題、既有對話、本次補充與附件解析內容 |
| T3.9 | 回答評判與錯誤回報命令：引用 Bot 回覆後以 `/judge correct`、`/judge incorrect <原因>`、`/judge partial`、`/judge amend <建議>` 判定 | T3.2, T3.3, T3.5 | 回報入口 | 使用者符合 `KNOWLEDGE_JUDGE_USERS` 或所屬群符合 `KNOWLEDGE_JUDGE_GROUPS` 時可評判；`partial` 由 AI 將回答拆為原子知識點，審核者逐項選擇正確／錯誤；`amend` 建立待審修訂候選；所有判定保存問題、回答、Evidence Workspace 快照與原因，不覆蓋舊知識 |

### 關卡 G3

- 審核入口可在所有學習寫入路徑啟用前使用。
- `approved_only` 與 `include_pending` 均經實際問答驗證；後者的待審警示不可遺漏。
- `/learn` 與自動學習皆已脫離 CSV。

---

## Phase 4：混合檢索

目標：以 FTS5 + 向量 + Metadata 篩選取代目前的單一語意搜尋，並消除缺陷 D2。

### 批次 4-A（技術面互相獨立，可同時開工）

| Track | 內容 | 依賴 | 產出 | 完成條件 |
| --- | --- | --- | --- | --- |
| T4.1 | 兩個 FTS5 虛擬表與同步觸發器：`document_chunks_fts`、`terms_fts` | G3 | schema + 觸發器 | 文件段落、術語、版本號與縮寫可命中；`machines` 維持既有名稱／tag SQL 比對，不混入此 Track |
| T4.2 | 持久化 `sqlite-vec`：`document_chunk_vectors` 與 `claim_vectors` 兩個獨立 `vec0` 表，含模型與內容雜湊中繼資料 | G3 | `src/db/vectors.ts` | 新增或變更條目只計算受影響向量；重啟不重算全部；兩類向量不可互查 |
| T4.3 | Query Planner：辨識目標類型、Minecraft 範圍、涉及術語、缺失條件 | G3, T2.9 | `src/services/queryPlanner.ts` | 版本不可推定時明確標示假設或詢問使用者 |

### 批次 4-B

| Track | 內容 | 依賴 | 產出 | 完成條件 |
| --- | --- | --- | --- | --- |
| T4.4 | Hybrid Retrieval：別名展開 + 兩個 FTS5 + 兩個向量索引；文件候選與 Claim 候選分開 RRF 後再合併 | T4.1, T4.2, T4.3 | `src/services/retrieval.ts` | 複雜問題可取多個互補證據，非單一最高分段落；試用模式可正確標記 pending 證據 |

### 批次 4-C

| Track | 內容 | 依賴 | 產出 | 完成條件 |
| --- | --- | --- | --- | --- |
| T4.5 | Metadata 篩選與重排序（狀態／版本／可信度加權） | T4.4 | 重排序模組 | 術語精確命中、版本相容、已核准者權重提高 |
| T4.6 | `services/embeddings.ts` 重構，移除每次 `/ask` 全量重建（修正 D2） | T4.2, T4.4 | 改寫後的 embeddings | `/ask` 只對使用者問題計算一次 embedding |

### 關卡 G4

- 評測題庫重跑，記錄命中證據正確性與版本正確性。
- `/ask` 延遲不再隨知識庫大小線性增長。

---

## Phase 5：證據式回答

目標：讓回答可引用、可區分確定程度。

### 批次 5-A（可同時開工）

| Track | 內容 | 依賴 | 產出 | 完成條件 |
| --- | --- | --- | --- | --- |
| T5.1 | Evidence Workspace 組裝：支持證據／反證／條件限制／缺失資訊／候選方案 | G4 | `src/services/evidence.ts` | 五個分類皆有內容來源 |
| T5.2 | 回答格式與語氣規則（prompt 層） | G4 | 更新 `agent/AGENTS.md` | 四種語氣類型可區分 |
| T5.3 | 引用渲染：來源連結與條目識別 | G4 | 渲染模組 | 每項依據可回鏈至具體條目 |

### 批次 5-B

| Track | 內容 | 依賴 | 產出 | 完成條件 |
| --- | --- | --- | --- | --- |
| T5.4 | 衝突與不確定性處理 | T5.1, T5.2 | 規則實作 | 兩份資料衝突時可指出版本與條件 |
| T5.3a | 來源 ID 對照表：由 `source_references` 產生本機 `source-id-map.json`，記錄 `SRC-*`、來源種類、原始路徑／URL、文件標題、段落路徑、內容雜湊與 visibility；Bot 以固定 URL 連至來源 ID | T1.2, T5.3 | 本地對照表 schema 與匯出器 | 每個可引用 Chunk 有永久、不重用的 `SRC-00000001`；對照表不含 Raw 正文、QQ ID、群組 ID 或附件內容；網站完全獨立，可自行抓取完整來源並按 ID 對應；歷史 CSV 與社群內容僅在 OpenST 公開條款 URL 已設定後輸出整理內容和匿名來源 |
| T5.5 | 錯誤回報入口接回待審區 | T5.3, T3.9 | 使用者入口 | 回報產生新待審項目，不覆蓋原知識 |

### 關卡 G5

- 評測題庫的「衝突處理」與「拒答能力」兩類全部通過。

---

## Phase 6：實驗資料

目標：預留結構落地，可人工匯入實測資料，不做自動化測試。

| Track | 內容 | 依賴 | 產出 | 完成條件 |
| --- | --- | --- | --- | --- |
| T6.1 | `experiments` / `experiment_measurements` / `experiment_evidence` 建表 | G5 | schema | |
| T6.2 | 人工匯入工具 | T6.1 | 匯入器 | 可記錄條件、步驟、測量值與樣本數 |
| T6.3 | Claim ↔ Experiment 連結 | T6.2, T3.2 | 關聯實作 | 可重現實測能連到 Claim |

---

## 橫向 Track

貫穿所有 Phase，不屬於單一階段。

| Track | 內容 | 建議時機 | 完成條件 |
| --- | --- | --- | --- |
| TX.1 | 評測執行器與回歸紀錄 | T0.4 之後持續 | 每次調整匯入、切段、搜尋、重排序、提示詞或審核規則都重跑並記錄五項指標 |
| TX.2 | 文件同步：AGENTS.md、README、本規劃書狀態更新 | 每個關卡 | 文件與實作不脫節 |
| TX.3 | 遷移後檔案政策落實 | 各來源遷移完成後 | 依〈遷移完成後的檔案政策〉表逐項確認 |
| TX.4 | 附件下載網域白名單（修正 D4） | 任意時機，與主線無依賴 | 與 `submissions/download.ts` 防護標準一致 |
| TX.5 | 清理未使用依賴 `express`、`multer`、`form-data`、`jszip` | 任意時機 | 攻擊面縮小；`npm run build` 與執行期不受影響 |

---

## 關鍵順序約束

以下順序若顛倒會造成返工或無法驗證，需特別注意。

1. **T0.2（枚舉）必須早於所有 schema Track**。狀態與可信度字串一旦散落在各表定義中，後續統一將牽動所有已寫入資料。
2. **T1.5a（遷移前快照）必須早於 T1.4b（改接 DB）**。程式碼一旦改動，基準即無法取得，「推薦行為不回歸」將無從驗證。
3. **T3.8（Answer Index 過濾）必須早於 T3.4／T3.5／T3.6（寫入路徑）**。過濾層未就位就開始寫入 pending 資料，等同讓未審核內容直接進入正式回答。
4. **T2.9（別名查詢）必須早於 T4.3（Query Planner）**。Query Planner 的術語展開依賴別名系統。
5. **T4.2（向量版本化）必須早於 T4.6（embeddings 重構）**。先有持久化與版本判斷，才能安全移除全量重建。
6. **T0.4（評測題庫）必須早於任何宣稱品質提升的變更**。對應非目標第 6 條。

## 平行度上限

| Phase | 可同時開工的最大 Track 數 | 瓶頸 |
| --- | --- | --- |
| 0 | 4 | 無，全部獨立 |
| 1 | 4（批次 1-B） | T1.1 為單點阻斷 |
| 2 | 5（批次 2-B） | T2.2 阻斷四個匯入器 |
| 3 | 4（批次 3-C） | T3.8 為安全前置 |
| 4 | 3（批次 4-A） | T4.4 為合流點 |
| 5 | 3（批次 5-A） | |
| 6 | 1 | 線性依賴 |

## AI 介入分工

AI 只負責理解、抽取、比較與表達；資料庫寫入、狀態轉移、版本過濾、雜湊去重、FTS/向量檢索、引用連結與權限檢查必須是可測試的確定性程式邏輯。所有 AI 產物都先是候選資料，不能自行建立 `approved` Claim 或覆蓋既有知識。

| 工作 | 是否需要 AI | 建議模型 | 規則 |
| --- | --- | --- | --- |
| JSON/CSV/Markdown 匯入、雜湊去重、版本欄位保存、FTS、sqlite-vec、狀態機、權限與引用渲染 | 不需要 | 不呼叫模型 | 必須可重複、可測試且無模型不確定性 |
| Markdown 標題切段、表格與程式碼區塊保留 | 不需要 | 不呼叫模型 | 採結構解析，不由 AI 改寫原文 |
| 已知術語的精確中英別名匹配 | 不需要 | 不呼叫模型 | 以 `term_aliases` 查詢；未知合併才交人工確認 |
| CSV 遺留資料的分類、正規化、術語合併候選、community note／Claim 草稿 | 需要 | DeepSeek V4 Flash | 151 筆邏輯記錄逐筆輸出結構化 JSON；只寫 `extraction_candidates`，通過規則驗證後才 materialize 為 `pending` |
| `/learn` 文字、附件與引用內容的標題建議、候選術語、Candidate Claim 草稿 | 需要 | DeepSeek V4 Flash | 背景批次工作；必須輸出結構化 JSON、保留原文與來源、寫入 `pending` |
| 主動／被動學習中的知識摘要與條件、例外抽取 | 需要 | DeepSeek V4 Flash | 只產生候選；被動學習輸入必含原問題、既有對話、本次補充與附件內容 |
| 問題意圖分類、版本／平台候選辨識、查詢改寫、術語擴展建議 | 可選 | 先規則，無法判定時用 Flash | Flash 結果只影響檢索召回，不可繞過版本或審核過濾 |
| `/judge partial` 的回答拆點、原因摘要與修訂候選歸類 | 可選 | DeepSeek V4 Flash | `/judge` 原始判定與理由為真源；AI 將回答拆為原子知識點供逐項判定，只能協助建立待審反證或修訂建議 |
| 跨多份文件的 Claim 草稿、版本衝突比較、證據支持與反證整理 | 需要 | DeepSeek V4 Pro | 必須列出每項證據 ID；無充分證據時輸出 `insufficient_evidence` |
| 複雜使用者問題的最終回答、設計取捨、瓶頸與因果分析 | 需要 | DeepSeek V4 Pro | 只能根據 Evidence Workspace；回答需區分事實、推論與假設 |
| 簡單術語定義或單一明確證據的回答 | 可選 | Flash 或不呼叫模型 | 優先直接渲染已核准術語／Claim；需要自然語言潤飾時才用 Flash |
| 審核建議、衝突案件摘要 | 可選 | Pro | 僅協助審核者閱讀，不可替代人工 approve/reject 決策 |

DeepSeek V4 Flash 適合高頻、低風險、可由人工覆核的候選產生工作；DeepSeek V4 Pro 用於跨證據推理與面向使用者的複雜回答。兩者共用現有 API；`src/config.ts` 以常數 `DEEPSEEK_MODEL_FLASH = 'deepseek-v4-flash'`、`DEEPSEEK_MODEL_PRO = 'deepseek-v4-pro'` 定義模型 ID。只有 `DEEPSEEK_API_KEY` 讀取環境變數。呼叫策略須集中在 `services/ai.ts`，每次呼叫明確選擇 Flash 或 Pro，業務模組不得自行直連模型 API。

## 開放問題

進入對應 Track 前需先取得決策。

| 編號 | 問題 | 阻斷 Track |
| --- | --- | --- |
| Q1 | 社群投稿內容的授權條款為何？`sources.license` 應填什麼 | T0.1 |
| Q2 | `database.json` 是否為 `website` 倉庫的同步鏡像？是否存在未同步落差 | T0.1、T1.4a |
| Q3 | `dictionary/`、`TechMC Glossary.csv` 目前是否有「PR review 才進庫」的實際流程？若無，可考慮改為 DB 直接為真源，降低複雜度 | T2.5、T2.7 |
| Q4 | `gtmc-database/` 的授權與再散布條件 | T0.1、T2.4 |
| Q5 | 審核人力規模為何？決定 Phase 3 的 pending 佇列是否會積壓 | T3.7 |
