# OpenST QQ Bot

[English](README.md) 中文

OpenST Minecraft 存储技术社区的模块化 QQ Bot。TypeScript 构建，DeepSeek AI 驱动。

## 功能

- `/ask` -- AI 问答，支持 Sentence-BERT 语义搜索和机器推荐
- `/learn` -- 社区知识共享，自动存入本地知识库
- `/upload` -- 机器投影上传，自动转 webp 并生成元数据
- `/ping` -- 连通性测试和群组 ID 诊断
- 用户独立对话上下文，多轮记忆互不干扰
- Markdown 回复通过 QQ 原生 Markdown API 直接发送（`msg_type=2`）
- 图片 OCR 支持（Tesseract.js）
- 附件解析（引用消息中的文本文件和图片）
- 群组白名单访问控制
- 对话自动学习

## 环境要求

- Node.js 20+
- QQ Bot App ID 和 App Secret（[申请地址](https://q.qq.com)）
- DeepSeek API Key（[获取地址](https://platform.deepseek.com)）

## 快速开始

```bash
# 克隆项目
git clone <repo-url>
cd OpenST-QQbot
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
QQ_APP_ID=你的AppId
QQ_APP_SECRET=你的AppSecret
QQ_GROUP_WHITELIST=群号1,群号2
DEEPSEEK_API_KEY=sk-你的key
UPLOAD_PORT=3000
UPLOAD_BASE_URL=http://localhost:3000
```

## 命令说明

| 命令 | 说明 |
|------|------|
| `/ask <问题>` | 询问 AI 关于 Minecraft 存储技术的问题，获取机器推荐 |
| `/ask` + 引用文件 | 分析引用的文本文件或 OCR 图片 |
| `/learn <标题> \| <内容>` | 向 bot 传授新知识 |
| `/learn` + 引用文件 | 从文档中学习知识 |
| `/upload` | 获取机器投影上传页面链接 |
| `/ping` | 检查 bot 状态，查看群组标识信息 |

## 项目结构

```
src/
  index.ts          入口（WebSocket + Express 双启动）
  config.ts         环境配置
  bot/
    adapter.ts      QQ API 适配层（WebSocket + HTTP）
    event.ts        事件分发器
  commands/
    router.ts       命令注册与路由
    ask.ts          /ask 命令处理
    upload.ts       /upload 命令处理
    learn.ts        /learn 命令处理
  services/
    ai.ts           DeepSeek AI 服务
    data.ts         CSV 词汇表和机器数据库加载
    dictionary.ts   存储技术词典加载
    context.ts      用户独立上下文管理
    learn.ts        自动学习服务
    embeddings.ts   Sentence-BERT 语义搜索引擎
    attachment.ts   文件下载和 OCR（Tesseract.js）
  upload/
    config.ts       上传分类配置
    server.ts       Express 上传服务
agent/
  AGENTS.md         AI 系统提示词
public/
  database/
    database.json   机器数据库（关键词匹配）
    database.csv    统一知识库（社区+GTMC+词汇表）
    database.md     社区学习知识库（源文件）
    TechMC Glossary.csv  术语词汇表（源文件）
    dictionary/     存储技术词典条目+翻译
    gtmc-database/  GTMC 参考文档（源文件）
```

## 许可证
GPL-3.0
