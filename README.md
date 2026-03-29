# cf_ai_interview_coach

An AI-powered coding interview practice agent built on Cloudflare. Chat with it to get LeetCode-style problems, receive Socratic hints, and track your progress across sessions. A weekly summary of your performance is generated automatically every Sunday.

## Architecture

- **Browser (Cloudflare Workers)** — React chat UI using the `useAgentChat` hook, connected via WebSocket
- **AIChatAgent (Durable Object)** — per-user agent instance with built-in SQLite state (`this.sql`)
- **Workers AI (Llama 3.3)** — `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for chat and weekly summaries
- **Cloudflare Workflow** — durable weekly summary job triggered by cron every Sunday at 09:00 UTC

## Try it live

[https://cf-ai-interview-coach.tutsam-singh.workers.dev](https://cf-ai-interview-coach.tutsam-singh.workers.dev)

## Run locally

```bash
git clone https://github.com/TutsamS/cf_ai_interview_coach
cd cf_ai_interview_coach
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

You must be authenticated with Wrangler (`wrangler login`) since the AI binding runs remotely.

## Deploy

```bash
npm run deploy
```

## Features

- **Socratic coaching** — gives hints, never solutions; pushes back on suboptimal approaches
- **Problem history sidebar** — shows all attempted problems, hint count, and solve status, updates live after each response
- **Cross-session memory** — chat history and problem attempts persist via Durable Object SQLite, survives page refreshes
- **Weekly summary** — Cloudflare Workflow runs every Sunday, generates a performance summary injected into the next session's context
- **`@callable()` method** — `getHistory()` is exposed directly to the frontend via the Agents SDK RPC, no REST endpoint needed
