# OpenST QQ Bot - AGENTS.md

## Build & Run

- `npm run build` -- `tsc` 编译 `src/` -> `dist/`
- `npm start` -- `node dist/index.js`（无 ts-node/watch，改代码后必须先 build）
- 入口: `src/index.ts`，启动 WebSocket 长连接（不运行 Express）
- 无 lint / test / format 命令
- 必须在仓库根目录运行：`config.ts` 用相对路径（`public/database/...` 等）读文件
- `src/upload/server.ts` 仅提供 token 生成/加密工具函数，bot 不再运行 Express 上传服务
- `postinstall` 脚本会删除 `@xenova/transformers` 内嵌的 `sharp@0.32.6`（Node.js 会回退到根 `sharp@0.33.5`），避免国内环境下载 libvips 超时导致安装失败

## Code Standards (强制)

- 单文件 ≤800 行，单行 ≤100 字符
- 代码注释使用中文，不含 emoji, 必须使用单行式注释，也就是 // 注释
- 驼峰命名，缩进 2 空格，运算符两侧空格
- 逻辑块间空行分隔
- tsconfig `strict` 开启；读环境变量用方括号 `process.env['FOO']`，点号写法会报错
- 所有配置常量集中在 `src/config.ts`，勿在业务代码散读 env

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
| `/search` | `handleSearch` | `src/commands/search.ts` |
| `/ping` | `pingHandler` | `src/commands/router.ts` |
| `/list` | `handleList` | `src/submissions/commands.ts` |

- `/ping` 和 `/upload` 绕过白名单；`/ping` 用于诊断（群返回 group_openid/group_id，私聊返回 user openid），`/upload` 用于投稿上传
- `/ask` 回复以 Markdown 消息直接发送（QQ 原生支持 `msg_type=2`）；默认注入联网搜索结果到 prompt，`SEARCH_IN_ASK=false` 关闭；支持引用消息/附件作为上下文；AI 无法回答时自动标记待学习并触发联网搜索补充
- `/learn` 写入 `public/database/database.csv`（topic,content 格式）；支持 `|` 分隔符指定标题和内容；支持引用消息和附件
- `/search` 联网搜索，默认 DuckDuckGo Lite（免费），可选 AI 摘要（`SEARCH_AI_SUMMARIZE` 控制）；支持引用消息作为搜索词
- `/list` 审核专用：查看已认领的投稿稿件，附带通过/拒稿按钮（支持 QQ 键盘交互 + 移动端文本回退）

## Key Services

| 服务 | 文件 | 职责 |
|------|------|------|
| ai | `services/ai.ts` | DeepSeek API 调用，机器推荐注入+验证 |
| data | `services/data.ts` | CSV 词汇表解析 + JSON 机器数据库加载 |
| dictionary | `services/dictionary.ts` | 术语词条匹配（`public/database/dictionary/`） |
| context | `services/context.ts` | 用户独立对话上下文，30min TTL，最多 8 轮 |
| attachment | `services/attachment.ts` | 附件下载 + OCR（Tesseract.js） |
| learn | `services/learn.ts` | 对话知识提取写入 CSV |
| embeddings | `services/embeddings.ts` | Sentence-BERT 语义搜索（本地 ONNX 推理） |
| source | `services/source.ts` | 自适应源码搜索（`public/database/source/`） |
| agent | `services/agent.ts` | Agent 模型分析源码（委托 DeepSeek 子任务） |
| search | `services/search.ts` | 联网搜索（DuckDuckGo/SearXNG + 可选 AI 摘要） |
| submissions | `src/submissions/` | 投稿审核系统（轮询 GitHub Issues、通知、认领、通过/拒稿） |

## Startup Flow

`src/index.ts` 顺序：
1. `dotenv/config` 加载 `.env`
2. `registerHandler(routeMessage)`
3. `warmupEmbedding()` — 预热 Sentence-BERT 模型（首次下载 ~470MB）
4. `initSubmissions()` — 初始化投稿审核系统（轮询 GitHub Issues + 注册交互事件）
5. `healthCheck()` — QQ API 连通性
6. `startWebSocket(onEvent)` — 长连接

## Data Files

| 路径 | 内容 |
|------|------|
| `public/database/database.json` | 机器数据库（只读） |
| `public/database/TechMC Glossary.csv` | 术语词汇表 |
| `public/database/database.csv` | 统一知识库（社区学习+GTMC文档+术语词汇，`/ask` 语义搜索来源） |
| `public/database/Dictionary.txt` | 存储技术词典源文件 |
| `public/database/submissions.json` | 投稿审核状态持久化（已见 issue、认领关系等，重启后恢复） |
| `agent/AGENTS.md` | AI 系统提示词（给 DeepSeek 的行为规则） |
| `public/database/dictionary/` | 存储技术词典（config.json + entries/ + zh-translations.json） |
| `public/database/source/` | 源码文件目录（`.java`、`.cpp` 等，`/ask` 触发技术关键词时搜索） |

## Environment

`.env` required: `QQ_APP_ID`, `QQ_APP_SECRET`, `DEEPSEEK_API_KEY`
Optional: `QQ_GROUP_WHITELIST`（逗号分隔，空则不限制）, `QQ_USER_WHITELIST`（逗号分隔，空则不限制）, `QQ_LEARN_WHITELIST`（逗号分隔，空则不限制，/learn 专用）, `UPLOAD_PORT`, `UPLOAD_BASE_URL`, `UPLOAD_SECRET`（上传令牌 HMAC 密钥）, `GITHUB_TOKEN`（上传加密用）, `UPLOAD_FRONTEND_URL`（上传前端部署地址）, `WORKER_URL`（投稿中继 API 地址，默认 `https://api.openstmc.com`）, `EMBEDDING_MODEL_MIRROR`（覆盖模型下载源，默认 `https://hf-mirror.com/`）, `EMBEDDING_MODEL_LOCAL`（本地预下载模型目录，离线用）, `HTTPS_PROXY`（模型下载代理，默认探测 `http://127.0.0.1:7890`）, `SEARCH_ENABLED`（联网搜索总开关，默认 `false`）, `SEARCH_IN_ASK`（/ask 联网搜索开关，默认开启，`false` 关闭）, `SEARCH_AI_SUMMARIZE`（/search AI 摘要开关，默认开启，`false` 关闭）, `SEARCH_CUSTOM_URL`（自定义 SearXNG 后端，留空用 DuckDuckGo）, `SEARCH_MAX_RESULTS`（搜索结果数，默认 5）, `SUBMISSIONS_AC`（接收新稿件通知的群组 openid，必填启用审核系统）, `SUBMISSIONS_REVIEWERS`（审核人员 openid 列表，逗号分隔）, `SUBMISSIONS_GH_TOKEN`（GitHub Token，需 Submissions + website 仓库权限，未设置则回退 GITHUB_TOKEN）, `SUBMISSIONS_POLL_INTERVAL_S`（轮询间隔秒数，默认 60）, `SUBMISSIONS_AT_COUNT`（通知时 @ 最闲审核人数，默认 2）

## Operational

- Upload 使用内存令牌，30min 过期，单次使用销毁
- 用户上下文 30min 无活动自动清理，群聊用户键为 `groupOpenid:authorId`
- 优雅退出清理：SIGINT/SIGTERM → shutdownSubmissions + closeOcr
- 群白名单支持 QQ 群号 + group_openid 两种匹配；用户白名单匹配 user openid
- 向 bot 私发 /ping 可获取 user openid，在目标群发 /ping 可获取 group_openid/group_id
- `dist/` 和 `node_modules/` 已 gitignore
