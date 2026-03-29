# PROMPTS.md

AI prompts used during the development of cf_ai_interview_coach.

---

## Project planning

> "I want to build a Cloudflare AI capstone project called cf_ai_interview_coach. It should be an AI-powered coding interview practice agent. You chat with it, it gives you problems (or lets you paste one), gives Socratic hints, tracks your history across sessions, and runs a scheduled weekly performance summary. It needs to hit all 4 requirements: LLM (Llama 3.3 on Workers AI), Workflow/coordination (Durable Objects + Cloudflare Workflows), user input via chat, and memory/state. Guide me through building it phase by phase."

---

## Phase 2 — System prompt

> "Write a system prompt for a coding interview coach AI that uses the Socratic method. It should ask clarifying questions, give hints rather than solutions, push back if an approach is suboptimal, and evaluate submitted solutions for correctness, edge cases, and time/space complexity. Keep it concise."

---

## Phase 3 — SQLite state tracking

> "Add SQLite memory to my AIChatAgent Durable Object. I want to track: which problems the user has attempted, whether they solved them, how many hints they needed, and timestamps. Use this.sql (the built-in SQLite in Durable Objects). Add methods: logAttempt, addHint, markSolved, getHistory, and clearAttempts. Also build a history summary string to inject into the system prompt so the agent knows what the user has already practiced."

---

## Phase 3 — Problem name extraction

> "Instead of logging 'pending' as the problem name upfront, use the streamText onFinish callback to extract the actual problem name from the first line of the AI's response and log it then. Also fix a bug where 'give me a hint' was matching the isNewProblemRequest check because it contains 'give me'."

---

## Phase 4 — Cloudflare Workflow

> "Write a Cloudflare Workflow class called WeeklySummaryWorkflow that: (1) fetches the user's problem attempt history from their Durable Object via an internal fetch, (2) calls Workers AI Llama 3.3 to generate a short encouraging weekly performance summary, (3) stores the summary back into the Durable Object. Use step.do() for each stage so the Workflow is durable and retries individual steps on failure. Also add a cron trigger in wrangler.jsonc to run it every Sunday."

---

## Phase 5 — Frontend polish

> "Update the React chat UI in app.tsx to: (1) rename the title from 'Agent Starter' to 'Interview Coach', (2) replace the example prompts with interview-relevant ones, (3) add a sidebar showing the user's problem history fetched via the @callable() getHistory method, updating after each AI response."
