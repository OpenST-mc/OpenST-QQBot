# OpenST QQ Bot - AGENTS.md

## Build & Run

- `npm run build` -- runs `tsc`, compiles `src/` -> `dist/`
- Entrypoint: `src/index.ts` -> `dist/index.js`
- No test, lint, or format commands configured yet

## Code Standards (强制)

- 单文件不超过 800 行，单行不超过 100 个字符
- 所有代码注释必须使用中文，不含 emoji
- 变量名采用驼峰命名法（camelCase）
- 缩进统一使用 2 空格
- 运算符两侧加空格（`a + b`，非 `a+b`）
- 逻辑块之间使用空行分隔

## Architecture

- 事件驱动的 QQ Bot（非简单聊天机器人）
- 模块化设计：每个模块单一职责、无状态、不直接依赖其他模块
- 命令显式注册/路由（禁止 if-else 链式分发）
- AI（DeepSeek）通过 service 层调用，业务逻辑不得直接访问 AI API
- QQ API 隔离在 bot/adapter 层，核心系统不直接依赖 QQ API 格式
- 所有错误在 router 层捕获，模块不得导致运行时崩溃

## Forbidden Patterns

- 业务逻辑内直接调用外部 API
- 跨模块耦合
- 存储原始用户对话历史
- 大规模 if-else 命令树
- 硬编码敏感信息
- 勿写入dist文件夹

## Project Structure

```
src/
  index.ts          -- 入口，启动 bot + upload server
  config.ts         -- 环境变量、常量
  bot/
    adapter.ts      -- QQ API 适配层（WebSocket + HTTP）
    event.ts        -- 事件分发
  commands/
    router.ts       -- 命令路由注册
    ask.ts          -- /ask 命令
    upload.ts       -- /upload 命令处理
    check.ts        -- /check 命令触发
  services/
    ai.ts           -- DeepSeek AI 服务
    data.ts         -- CSV 词汇表 + 远程 JSON 数据
  upload/
    server.ts       -- 上传页面的 Express 服务
    config.js       -- 上传分类配置
  check/
    checker.ts      -- 静态代码审查引擎
agent/
  AGENTS.md         -- AI prompt 规则文件
public/database/
  TechMC Glossary.csv  -- 术语词汇表
```
