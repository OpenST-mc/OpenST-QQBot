# OpenST QQ Bot

[English](README.md) | 中文

OpenST Minecraft 存储技术社区的模块化 QQ Bot。TypeScript 构建，DeepSeek AI 驱动。

## 功能

- `/ask` -- AI 问答，支持 Sentence-BERT 语义搜索、机器推荐和源码分析
- `/search` -- 联网搜索（DuckDuckGo / SearXNG），可选 AI 摘要
- `/learn` -- 社区知识共享，自动存入本地知识库
- `/upload` -- 机器投影上传，自动转 webp 并生成元数据
- `/ping` -- 连通性测试和群组/用户 ID 诊断
- `/list` -- 投稿审核面板，附带认领/通过/拒稿按钮
- 用户独立对话上下文，30 分钟 TTL，最多 8 轮对话
- Markdown 回复通过 QQ 原生 Markdown API 直接发送（`msg_type=2`）
- 图片 OCR 支持（Tesseract.js）
- 附件解析（引用消息中的文本文件和图片）
- 群组白名单 + 用户白名单访问控制
- 对话自动学习（被动提取 + 主动检测双模式）
- 源码文件搜索 + Agent 模型分析（委托 DeepSeek 子任务）
- 投稿审核系统（轮询 GitHub Issues、通知、负载均衡分配审核）

## 环境要求

- Node.js 20+
- QQ Bot App ID 和 App Secret（[申请地址](https://q.qq.com)）
- DeepSeek API Key（[获取地址](https://platform.deepseek.com)）
- GitHub Token（可选，投稿审核系统需要）

## 快速开始

```bash
# 克隆项目
git clone <repo-url>
cd OpenST-QQBot
npm install

# 配置
cp .env.example .env
# 编辑 .env 填入凭证

# 构建并启动
npm run build
npm start
```

## .env 配置

```ini
# 必填
QQ_APP_ID=你的AppId
QQ_APP_SECRET=你的AppSecret
DEEPSEEK_API_KEY=sk-你的key

# 访问控制
QQ_GROUP_WHITELIST=群号1,群号2                # 逗号分隔，留空不限制
QQ_USER_WHITELIST=用户openid1,用户openid2
QQ_LEARN_WHITELIST=用户openid1,群号1           # /learn 专用白名单

# 上传
UPLOAD_FRONTEND_URL=https://你的前端地址.vercel.app
WORKER_URL=https://api.openstmc.com           # 上传中继 API（默认）
UPLOAD_SECRET=                                # 与 Vercel 保持一致的 32 随机 bytes 密钥
# Vercel 还需配置 GITHUB_TOKEN、UPLOAD_SECRET 和 WORKER_URL

# 联网搜索（默认 DuckDuckGo，免费）
SEARCH_ENABLED=true                           # 总开关
SEARCH_IN_ASK=true                            # /ask 默认注入搜索结果
SEARCH_CUSTOM_URL=                            # 可选 SearXNG 后端
SEARCH_MAX_RESULTS=5
SEARCH_AI_SUMMARIZE=true

# 投稿审核系统
SUBMISSIONS_AC=群group_openid                  # 通知目标群
SUBMISSIONS_REVIEWERS=openid1,openid2          # 审核员列表
SUBMISSIONS_GH_TOKEN=ghp_xxx                   # GitHub Token（需仓库权限）
SUBMISSIONS_POLL_INTERVAL_S=60
SUBMISSIONS_AT_COUNT=2                         # @ 提示最闲审核人数

# 模型下载
EMBEDDING_MODEL_MIRROR=https://hf-mirror.com/ # HF 镜像源
EMBEDDING_MODEL_LOCAL=                        # 本地预下载模型目录
HTTPS_PROXY=http://127.0.0.1:7890             # 模型下载代理
```

## 命令说明

| 命令 | 说明 |
|------|------|
| `/ask <问题>` | 询问 AI 关于 Minecraft 存储技术的问题，获取机器推荐 |
| `/ask` + 引用消息/文件 | 分析文本文件、OCR 图片或引用内容 |
| `/search <关键词>` | 联网搜索，可选 AI 摘要 |
| `/search` + 引用消息 | 在线搜索引用消息内容 |
| `/learn <标题> \| <内容>` | 向 bot 传授新知识 |
| `/learn` + 引用文件 | 从文档中学习知识 |
| `/upload` | 获取机器投影上传页面链接 |
| `/list` | 审核员：查看已认领稿件，附带通过/拒稿按钮 |
| `/ping` | 检查 bot 状态，查看群组/用户标识信息 |

## 项目结构

```
src/
  index.ts              入口（WebSocket 长连接）
  config.ts             环境配置（所有常量集中管理）
  bot/
    adapter.ts          QQ API 适配层（WebSocket + HTTP，消息/键盘发送）
    event.ts            事件分发器（消息 + 交互事件路由）
  commands/
    router.ts           命令注册、白名单检查、消息路由
    ask.ts              /ask 处理器（语义搜索、AI、机器推荐、Agent 委托）
    search.ts           /search 处理器（联网搜索 + AI 摘要）
    learn.ts            /learn 处理器（社区知识录入）
    upload.ts           /upload 处理器（令牌生成 + 上传页面 URL）
  services/
    ai.ts               DeepSeek API（对话、带 ID 验证的推荐）
    data.ts             CSV 词汇表解析 + JSON 机器数据库加载
    dictionary.ts       存储技术词典加载（dictionary/entries/）
    context.ts          用户独立对话上下文（30min TTL，8 轮上限）
    learn.ts            自动学习（被动：对话提取，主动：消息检测）
    embeddings.ts       Sentence-BERT 语义搜索（本地 ONNX 推理）
    attachment.ts       文件下载 + OCR（Tesseract.js）
    source.ts           自适应源码搜索（public/database/source/）
    agent.ts            Agent 模型源码分析（委托 DeepSeek 子任务）
    search.ts           联网搜索（DuckDuckGo Lite / SearXNG + AI 摘要）
  submissions/
    index.ts            模块入口（初始化 + 关闭）
    monitor.ts          GitHub Issues 轮询 + 新 Issue 检测
    notify.ts           通知格式化（Markdown + 键盘按钮）
    interact.ts         按钮交互处理（认领/通过/拒稿）
    actions.ts          Issue 生命周期操作（认领、通过、拒稿）
    commands.ts         /list 命令处理器（审核面板）
    state.ts            内存 + 文件持久化的投稿状态
    reviewer.ts         审核员管理（负载均衡空闲选取）
    gh.ts               GitHub API 客户端（列出 Issue、添加标签、评论）
    config.ts           投稿模块专用配置
  upload/
    server.ts           令牌生成 + 加密工具（不再运行 Express 服务）
    config.ts           上传分类定义
agent/
  AGENTS.md             AI 系统提示词（DeepSeek 行为规则）
public/
  database/
    database.json       机器数据库（关键词匹配，只读）
    database.csv        统一知识库（社区学习+GTMC 文档+术语词汇）
    database.md         社区学习知识（源文件）
    TechMC Glossary.csv 术语词汇表（源文件）
    Dictionary.txt      存储技术词典（源文件）
    dictionary/         技术词典条目+翻译（config.json, entries/, zh-translations.json）
    gtmc-database/      GTMC 参考文档（源文件）
    source/             源码文件目录（.java, .cpp 等，/ask Agent 分析来源）
    submissions.json    投稿审核状态（重启后持久化恢复）
```

## 许可证
GPL-3.0
