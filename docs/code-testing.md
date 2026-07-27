# 程式單元測試規範

## 1. 目的與範圍

本文件規範 `src/` 各程式單元的自動化測試。測試應驗證可觀察行為、錯誤處理
與邊界條件，不以實作細節、私有變數或呼叫次數作為主要斷言。

目前專案尚未選定測試 runner。本規範不新增測試依賴、不新增 `npm test`，但往後選
用的 runner 必須能執行 TypeScript、支援非同步測試，並可替換 HTTP、檔案系統、時鐘
與 QQ/AI 外部邊界。

## 2. 檔案與命名

```text
tests/
  unit/
    config.test.ts
    bot/
      event.test.ts
      adapter.test.ts
    commands/
      ask.test.ts
      learn.test.ts
      router.test.ts
      search.test.ts
      upload.test.ts
    services/
      ai.test.ts
      attachment.test.ts
      context.test.ts
      data.test.ts
      dictionary.test.ts
      embeddings.test.ts
      learn.test.ts
      search.test.ts
      source.test.ts
    submissions/
      actions.test.ts
      commands.test.ts
      download.test.ts
      gh.test.ts
      interact.test.ts
      monitor.test.ts
      notify.test.ts
      pathSafety.test.ts
      reviewer.test.ts
      state.test.ts
    upload/
      server.test.ts
  fixtures/
    unit/
```

- 每個 production module 對應一個同路徑 `.test.ts`；只有純 re-export 或啟動組裝檔可
  不建立獨立測試。
- 測試資料放在 `tests/fixtures/unit/`，不得讀取或修改 `public/database/` 的正式資料。
- Fixture 檔名以行為命名，例如 `invalid-zip.bin`、`glossary-minimal.csv`；不得使用真實
  token、QQ openid、GitHub token 或使用者附件。
- 新增 module 時，PR 必須同時新增對應測試，或在 PR 說明無法單元測試的外部邊界與
  替代驗證方式。

## 3. 隔離規則

- 單元測試不得發送 HTTP 請求、連線 WebSocket、呼叫 DeepSeek、下載模型、執行 OCR，
  或存取 GitHub、QQ、DuckDuckGo/SearXNG。
- 時鐘、亂數、環境變數、檔案系統與計時器必須可控制。測試後必須還原環境變數與 fake
  timer，避免跨案例污染。
- AI、QQ、GitHub、搜尋與檔案下載僅測試請求建構、回應解析、重試/失敗分支與呼叫端
  可觀察結果；傳輸層使用 fake 或 mock。
- 不得為了測試而在業務程式加入全域 test mode。需要隔離時，優先將純運算抽為函式，
  或在 module 邊界注入最小依賴。
- 狀態型 module 每個案例必須建立獨立狀態，並在 `afterEach` 清除 context、cache、
  interval 與暫存檔。

## 4. 每類單元的最低覆蓋

| 單元 | 對應檔案 | 最低測試案例 |
| --- | --- | --- |
| 設定 | `config.ts`、`upload/config.ts`、`submissions/config.ts` | 預設值、CSV 白名單解析、布林/數值邊界、缺失必要設定 |
| 事件分派 | `bot/event.ts` | 訊息與互動正確分派、未註冊 handler、handler 拒絕時不造成未處理錯誤 |
| QQ adapter | `bot/adapter.ts` | token 快取/過期、請求 payload、非 2xx/無效回應、訊息類型與 keyboard payload；HTTP/WebSocket 必須 fake |
| 路由 | `commands/router.ts` | 命令解析、白名單、`/ping` 與 `/upload` 繞過規則、未知命令、handler 失敗時的使用者回覆 |
| 命令 handler | `commands/*.ts` | 正常輸入、空白/引用/附件、服務失敗、回覆內容與副作用；不得直接測試 AI 或 QQ 網路 |
| AI 服務 | `services/ai.ts`、`services/agent.ts` | Flash/Pro 模型選擇、prompt 組裝、JSON/Markdown 回應解析、timeout/非 2xx、推薦結果驗證 |
| 資料與術語 | `services/data.ts`、`dictionary.ts` | 最小合法資料、空檔、損壞 JSON/CSV、大小寫/別名命中、排序與去重 |
| 對話狀態 | `services/context.ts` | 群組與私聊 key 隔離、最多 8 輪、30 分鐘 TTL、pending learn consume 一次、shutdown 清理 |
| 學習 | `services/learn.ts`、`commands/learn.ts` | 可學習判定、`title|content` 解析、去重、CSV 寫入失敗、上下文提取失敗 |
| 附件/OCR | `services/attachment.ts` | 無附件、支援/不支援格式、下載或 OCR 失敗、文字長度限制、資源釋放；下載與 OCR 必須 fake |
| 向量與來源 | `services/embeddings.ts`、`source.ts` | 空索引、排序、結果上限、快取清除、無匹配結果；不得下載 ONNX 模型或讀取正式來源庫 |
| 搜尋 | `services/search.ts`、`commands/search.ts` | 開關關閉、自訂/預設後端、HTML 解析、結果上限、摘要失敗回退；HTTP 與 AI 必須 fake |
| 投稿純邏輯 | `submissions/pathSafety.ts`、`reviewer.ts`、`state.ts`、`download.ts` | traversal/絕對路徑拒絕、審核者選取、持久化讀寫與損壞狀態、下載 URL 解析、ZIP 安全限制 |
| 投稿協作 | `submissions/actions.ts`、`commands.ts`、`interact.ts`、`monitor.ts`、`notify.ts`、`gh.ts`、`index.ts` | claim/approve/reject 狀態轉換、權限拒絕、重複事件、polling start/stop、通知 payload、GitHub 失敗；GitHub/QQ/計時器必須 fake |
| 上傳工具 | `upload/server.ts` | token 格式、HMAC 驗證、過期、單次使用、錯誤簽名；不可使用真實 secret |
| 啟動組裝 | `index.ts` | 不要求單元測試；由未來 smoke test 驗證初始化順序與優雅關閉 |

## 5. 案例結構與斷言

- 每個測試名稱以「情境 + 預期行為」描述，例如「過期 token 會被拒絕」。
- 每個公開函式至少覆蓋成功、空值/最小輸入、無效輸入與外部依賴失敗四類情境；純函式可
  依不適用情況省略外部失敗案例。
- 每個 bug 修正必須先加入能重現該 bug 的 regression case，再修正 production code。
- 對非同步失敗使用 rejection/assertion 驗證；不得以 sleep 等待結果。
- 斷言穩定的輸出、狀態與副作用，不斷言 prompt 的完整字串、隨機 token 的具體值或
  外部服務實作細節。
- 需要時間或亂數時，注入固定 clock/seed，或只斷言格式、範圍與可驗證關係。

## 6. 未來 Runner 接入契約

- 新增 runner 時，加入 `npm test`，預設執行 `tests/unit/**/*.test.ts`。
- TypeScript 編譯設定必須將 `tests/` 與 production `src/` 分離，避免測試輸出進入
  `dist/` 與 production 啟動路徑。
- CI 至少執行 build、unit tests 與既有 `npm run audit`。
- 測試不可依賴網路、使用者 `.env`、本機模型快取或正式資料庫；在乾淨 checkout 中必須
  可重現。
- 本規範僅涵蓋程式單元測試。`eval/questions.json` 與
  `eval/fixtures/triage/` 是知識檢索/文件攝取評測資料，規則見
  `docs/document-ingestion.md`，不可混入 `tests/unit/`。
