# OpenST QQ Bot - AGENTS.md

## Build & Run

- `npm run build` -- `tsc` 编译 `src/` -> `dist/`
- `npm start` -- `node dist/index.js`
- 入口: `src/index.ts`，启动 WebSocket + Express 双服务
- 无 lint / test / format 命令

## Code Standards (强制)

- 单文件 ≤800 行，单行 ≤100 字符
- 代码注释使用中文，不含 emoji, 必须使用单行式注释，也就是 // 注释
- 驼峰命名，缩进 2 空格，运算符两侧空格
- 逻辑块间空行分隔

## Architecture

- 事件驱动：adapter → event dispatcher → router → handler
- QQ API 隔离在 `bot/adapter.ts`，核心系统不直接依赖 QQ 协议
- AI 调用走 `services/ai.ts`，业务代码不直调 DeepSeek
- 命令显式注册到 `commandMap`（`router.ts:20`），禁止 if-else 链
- 错误在 router 层捕获，模块不抛至顶层

## Commands

| 命令 | 注册名 | 文件 |
|------|--------|------|
| `/ask` | `handleAsk` | `src/commands/ask.ts` |
| `/learn` | `handleLearn` | `src/commands/learn.ts` |
| `/upload` | `handleUpload` | `src/commands/upload.ts` |
| `/ping` | `pingHandler` | `src/commands/router.ts` |

- `/ping` 绕过白名单，用于诊断
- `/ask` 回复以 Markdown 消息直接发送（QQ 原生支持 `msg_type=2`）
- `/learn` 写入 `public/database/database.csv`（topic,content 格式）

## Key Services

| 服务 | 文件 | 职责 |
|------|------|------|
| ai | `services/ai.ts` | DeepSeek API 调用，机器推荐注入+验证 |
| data | `services/data.ts` | CSV 词汇表解析 + JSON 机器数据库加载 |
| dictionary | `services/dictionary.ts` | 术语词条匹配（`public/database/dictionary/`） |
| context | `services/context.ts` | 用户独立对话上下文，30min TTL，最多 8 轮 |
| render | `services/render.ts` | (已删除) `/ask` 改为 Markdown 消息直接发送 |
| attachment | `services/attachment.ts` | 附件下载 + OCR（Tesseract.js） |
| learn | `services/learn.ts` | 对话知识提取写入 CSV |
| embeddings | `services/embeddings.ts` | Sentence-BERT 语义搜索（本地 ONNX 推理） |

## Startup Flow

`src/index.ts` 顺序：
1. `dotenv/config` 加载 `.env`
2. `registerHandler(routeMessage)`
3. `startUploadServer()` — Express 侧端口
4. `warmupEmbedding()` — 预热 Sentence-BERT 模型（首次下载 ~470MB）
5. `healthCheck()` — QQ API 连通性
6. `startWebSocket(onEvent)` — 长连接

## Data Files

| 路径 | 内容 |
|------|------|
| `public/database/database.json` | 机器数据库（只读） |
| `public/database/TechMC Glossary.csv` | 术语词汇表 |
| `public/database/database.csv` | 统一知识库（社区学习+GTMC文档+术语词汇，`/ask` 语义搜索来源） |
| `agent/AGENTS.md` | AI 系统提示词（给 DeepSeek 的行为规则） |
| `public/database/dictionary/` | 存储技术词典（config.json + entries/ + zh-translations.json） |

## Environment

`.env` required: `QQ_APP_ID`, `QQ_APP_SECRET`, `DEEPSEEK_API_KEY`
Optional: `QQ_GROUP_WHITELIST`（逗号分隔，空则不限制）, `UPLOAD_PORT`, `UPLOAD_BASE_URL`

## Operational

- Upload 使用内存令牌，30min 过期，单次使用销毁
- 用户上下文 30min 无活动自动清理，群聊用户键为 `groupOpenid:authorId`
- 优雅退出清理：SIGINT/SIGTERM → closeOcr
- 群白名单支持 QQ 群号 + group_openid 两种匹配
- `dist/` 和 `node_modules/` 已 gitignore
