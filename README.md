# OpenST QQ Bot

English | [中文](README_zh.md)

Event-driven modular QQ Bot for the OpenST Minecraft storage-tech community.
Built with TypeScript, powered by DeepSeek AI.

## Features

- `/ask` -- AI-powered Q&A with Sentence-BERT semantic search, machine recommendations, and source code analysis
- `/search` -- Web search via DuckDuckGo or SearXNG, with optional AI summary
- `/learn` -- Community knowledge sharing, auto-saved to local knowledge base
- `/upload` -- Machine blueprint upload with webp conversion and metadata generation
- `/ping` -- Connectivity test and group/user ID diagnostics
- `/list` -- Submissions review panel with claim/approve/reject buttons
- Per-user conversation context with independent history, 30min TTL, max 8 turns
- Markdown reply sent directly via QQ native Markdown API (`msg_type=2`)
- Image OCR support via Tesseract.js
- Attachment parsing (text files, images from quoted messages)
- Group whitelist + user whitelist for access control
- Auto-learning from user conversations (passive + active modes)
- Source code search with agent model analysis (delegates to DeepSeek sub-agent)
- Submissions audit system (poll GitHub Issues, notification, review workflow with load-balanced assignments)

## Requirements

- Node.js 20+
- QQ Bot App ID and App Secret ([apply here](https://q.qq.com))
- DeepSeek API Key ([get one here](https://platform.deepseek.com))
- GitHub Token (optional, required for submissions audit system)

## Quick Start

```bash
# Clone and install
git clone <repo-url>
cd OpenST-QQBot
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
# Required
QQ_APP_ID=your_app_id
QQ_APP_SECRET=your_app_secret
DEEPSEEK_API_KEY=sk-your-key

# Access Control
QQ_GROUP_WHITELIST=group_id_1,group_id_2    # comma-separated, empty = allow all
QQ_USER_WHITELIST=user_openid_1,user_openid_2
QQ_LEARN_WHITELIST=user_openid_1,group_id_1  # /learn-only whitelist

# Upload
UPLOAD_FRONTEND_URL=https://your-upload-frontend.vercel.app
WORKER_URL=https://api.openstmc.com           # upload relay API (default)

# Web Search (default: DuckDuckGo, free)
SEARCH_ENABLED=true                           # global switch
SEARCH_IN_ASK=true                            # inject search into /ask (default on)
SEARCH_CUSTOM_URL=                            # optional SearXNG backend
SEARCH_MAX_RESULTS=5
SEARCH_AI_SUMMARIZE=true

# Submissions Audit System
SUBMISSIONS_AC=group_openid                   # notification target group
SUBMISSIONS_REVIEWERS=openid1,openid2         # reviewer list
SUBMISSIONS_GH_TOKEN=ghp_xxx                  # GitHub token with repo access
SUBMISSIONS_POLL_INTERVAL_S=60
SUBMISSIONS_AT_COUNT=2                        # @mention N idle reviewers

# Model
EMBEDDING_MODEL_MIRROR=https://hf-mirror.com/ # HF mirror for model download
EMBEDDING_MODEL_LOCAL=                        # local pre-downloaded model dir
HTTPS_PROXY=http://127.0.0.1:7890             # proxy for model download
```

## Commands

| Command | Description |
|---------|-------------|
| `/ask <question>` | Ask AI about Minecraft storage tech, get machine recommendations |
| `/ask` + quoted message/file | Analyze text files, OCR images, or referenced content |
| `/search <keywords>` | Web search with optional AI summary |
| `/search` + quoted message | Search referenced message content online |
| `/learn <title> \| <content>` | Teach the bot new knowledge |
| `/learn` + quoted file | Learn from attached documents |
| `/upload` | Get upload page link for machine blueprints |
| `/list` | Reviewers: view claimed submissions with approve/reject buttons |
| `/ping` | Check bot status and view group/user identifiers |

## Project Structure

```
src/
  index.ts              Entry point (WebSocket long connection)
  config.ts             Environment configuration (all constants centralized)
  bot/
    adapter.ts          QQ API layer (WebSocket + HTTP, message/keyboard sending)
    event.ts            Event dispatcher (message + interaction routing)
  commands/
    router.ts           Command registry, whitelist enforcement, message routing
    ask.ts              /ask handler (semantic search, AI, machine recs, agent delegation)
    search.ts           /search handler (web search + AI summary)
    learn.ts            /learn handler (community knowledge recording)
    upload.ts           /upload handler (token generation + upload page URL)
  services/
    ai.ts               DeepSeek API (chat, recommendations with ID validation)
    data.ts             CSV glossary parser + JSON machine database loader
    dictionary.ts       Storage Tech Dictionary loader (dictionary/entries/)
    context.ts          Per-user conversation context (30min TTL, 8-turn max)
    learn.ts            Auto-learning (passive: dialog extraction, active: message extraction)
    embeddings.ts       Sentence-BERT semantic search (local ONNX inference)
    attachment.ts       File download + OCR (Tesseract.js)
    source.ts           Adaptive source code search (public/database/source/)
    agent.ts            Agent model for source analysis (delegates DeepSeek sub-tasks)
    search.ts           Web search (DuckDuckGo Lite / SearXNG + AI summarization)
  submissions/
    index.ts            Module entry (init + shutdown)
    monitor.ts          GitHub Issues polling + new issue detection
    notify.ts           Notification formatting (Markdown + keyboard buttons)
    interact.ts         Button interaction handler (claim/approve/reject)
    actions.ts          Issue lifecycle actions (claim, approve, reject)
    commands.ts         /list command handler (review panel)
    state.ts            In-memory + file-persisted submission state
    reviewer.ts         Reviewer management (load-balanced idle picker)
    gh.ts               GitHub API client (list issues, add labels, comments)
    config.ts           Submissions-specific config parsing
  upload/
    server.ts           Token generation + encryption utilities (no Express server)
    config.ts           Upload category definitions
agent/
  AGENTS.md             AI system prompt (behavior rules for DeepSeek)
public/
  database/
    database.json       Machine database (keyword-matched, read-only)
    database.csv        Unified knowledge base (community + GTMC + glossary)
    database.md         Community-learned knowledge (source)
    TechMC Glossary.csv Terminology glossary (source)
    Dictionary.txt      Storage tech dictionary (source)
    dictionary/         Tech dictionary entries + translations (config.json, entries/, zh-translations.json)
    gtmc-database/      GTMC reference documents (source)
    source/             Source code files (.java, .cpp, etc.) for /ask agent analysis
    submissions.json    Submission audit state (persisted between restarts)
```

## License
GPL-3.0
