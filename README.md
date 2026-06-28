# OpenST QQ Bot

English [中文](README_zh.md)

Event-driven modular QQ Bot for the OpenST Minecraft storage-tech community.
Built with TypeScript, powered by DeepSeek AI.

## Features

- `/ask` -- AI-powered Q&A with Sentence-BERT semantic search and machine recommendations
- `/learn` -- Community knowledge sharing, auto-saved to local knowledge base
- `/upload` -- Machine blueprint upload with webp conversion and metadata generation
- `/ping` -- Connectivity test and group ID diagnostics
- Per-user conversation context with independent history
- Markdown reply sent directly via QQ native Markdown API (`msg_type=2`)
- Image OCR support via Tesseract.js
- Attachment parsing (text files and images from quoted messages)
- Group whitelist for bot access control
- Auto-learning from user conversations

## Requirements

- Node.js 20+
- QQ Bot App ID and App Secret ([apply here](https://q.qq.com))
- DeepSeek API Key ([get one here](https://platform.deepseek.com))

## Quick Start

```bash
# Clone and install
git clone <repo-url>
cd OpenST-QQbot
npm install

# Configure
cp .env.example .env
# Edit .env with your credentials

# Build and run
npm run build
npm start
```

## .env Configuration

```ini
QQ_APP_ID=your_app_id
QQ_APP_SECRET=your_app_secret
QQ_GROUP_WHITELIST=group_id_1,group_id_2
DEEPSEEK_API_KEY=sk-your-key
UPLOAD_PORT=3000
UPLOAD_BASE_URL=http://localhost:3000
```

## Commands

| Command | Description |
|---------|-------------|
| `/ask <question>` | Ask AI about Minecraft storage tech, get machine recommendations |
| `/ask` + quote file | Analyze attached text files or OCR images |
| `/learn <title> \| <content>` | Teach the bot new knowledge |
| `/learn` + quote file | Learn from attached documents |
| `/upload` | Get upload page link for machine blueprints |
| `/ping` | Check bot status and view group identifiers |

## Project Structure

```
src/
  index.ts          Entry point (WebSocket + Express)
  config.ts         Environment configuration
  bot/
    adapter.ts      QQ API layer (WebSocket + HTTP)
    event.ts        Event dispatcher
  commands/
    router.ts       Command registry and routing
    ask.ts          /ask command handler
    upload.ts       /upload command handler
    learn.ts        /learn command handler
  services/
    ai.ts           DeepSeek AI service
    data.ts         CSV glossary and machine database loader
    dictionary.ts   Storage Tech Dictionary loader
    context.ts      Per-user conversation context manager
    learn.ts        Auto-learning service
    embeddings.ts   Sentence-BERT semantic search engine
    attachment.ts   File download and OCR (Tesseract.js)
  upload/
    config.ts       Upload category definitions
    server.ts       Express upload server
agent/
  AGENTS.md         AI system prompt
public/
  database/
    database.json   Machine database (keyword-matched)
    database.csv    Unified knowledge base (community + GTMC + glossary)
    database.md     Community-learned knowledge (source)
    TechMC Glossary.csv  Terminology glossary (source)
    dictionary/     Storage Tech Dictionary entries + translations
    gtmc-database/  GTMC reference documents (source)
```

## License
GPL-3.0
