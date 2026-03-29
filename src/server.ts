import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest, callable } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { streamText, convertToModelMessages, pruneMessages } from "ai";

export { WeeklySummaryWorkflow } from "./workflow";

const BASE_SYSTEM_PROMPT = `You are an expert coding interview coach. Your job is to help users practice technical interviews using the Socratic method.

When a user gives you a coding problem (or asks for one):
1. If they ask for a problem, pick an appropriate LeetCode-style problem based on their stated skill level or default to medium difficulty. State the problem name clearly on the first line.
2. Ask clarifying questions before giving hints — make the user think first.
3. Never give away the full solution. Instead, give progressively more specific hints only when the user is stuck.
4. Push back if the user proposes a suboptimal approach — ask them to think about time/space complexity.
5. When the user submits a solution, evaluate it: correctness, edge cases, time complexity, space complexity.
6. Be encouraging but honest. If an approach is wrong, say so clearly and guide them toward the right path.

Keep responses concise. One hint at a time. Make the user do the thinking.`;

export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;

  // Runs once when the Durable Object is first created
  onStart() {
    this.sql`
      CREATE TABLE IF NOT EXISTS attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        problem_name TEXT NOT NULL,
        hints_used INTEGER DEFAULT 0,
        solved INTEGER DEFAULT 0,
        started_at TEXT DEFAULT (datetime('now'))
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        summary TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `;
  }

  // Called by the Workflow to push the weekly summary into this Durable Object
  async storeSummary(summary: string) {
    this.sql`INSERT INTO summaries (summary) VALUES (${summary})`;
  }

  // Load the latest weekly summary to inject into the system prompt
  getLatestSummary(): string {
    const rows = [
      ...this.sql`SELECT summary FROM summaries ORDER BY id DESC LIMIT 1`
    ];
    return rows.length > 0 ? (rows[0].summary as string) : "";
  }

  async logAttempt(problemName: string) {
    this.sql`INSERT INTO attempts (problem_name) VALUES (${problemName})`;
  }

  async addHint(problemName: string) {
    this.sql`
      UPDATE attempts
      SET hints_used = hints_used + 1
      WHERE id = (SELECT MAX(id) FROM attempts WHERE problem_name = ${problemName})
    `;
  }

  async markSolved(problemName: string) {
    this.sql`
      UPDATE attempts
      SET solved = 1
      WHERE id = (SELECT MAX(id) FROM attempts WHERE problem_name = ${problemName})
    `;
  }

  // Exposed to the frontend so the sidebar can fetch history directly
  @callable()
  async getHistory() {
    const rows = this.sql`
      SELECT problem_name, hints_used, solved, started_at
      FROM attempts
      ORDER BY started_at DESC
      LIMIT 20
    `;
    return [...rows];
  }

  buildHistoryContext(): string {
    const rows = this.sql`
      SELECT problem_name, hints_used, solved, started_at
      FROM attempts
      ORDER BY started_at DESC
      LIMIT 10
    `;
    const attempts = [...rows];
    if (attempts.length === 0) return "";

    const lines = attempts.map((r) => {
      const status = r.solved ? "solved" : "attempted";
      return `- ${r.problem_name}: ${status}, ${r.hints_used} hints used`;
    });

    return `\n\nUser's recent problem history:\n${lines.join("\n")}\n\nUse this to tailor difficulty and avoid repeating recently solved problems.`;
  }

  // Detect if user is asking for a new problem
  isNewProblemRequest(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.includes("give me") ||
      lower.includes("new problem") ||
      lower.includes("another problem") ||
      lower.includes("practice problem") ||
      lower.includes("leetcode")
    );
  }

  // Detect if user is asking for a hint
  isHintRequest(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.includes("hint") ||
      lower.includes("stuck") ||
      lower.includes("help me") ||
      lower.includes("i don't know") ||
      lower.includes("i dont know") ||
      lower.includes("clue")
    );
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    // Get the latest user message text
    const lastMessage = this.messages[this.messages.length - 1];
    const userText =
      lastMessage?.role === "user"
        ? lastMessage.parts
            .filter((p) => p.type === "text")
            .map((p) => (p as { type: "text"; text: string }).text)
            .join(" ")
        : "";

    // Track attempt if user is asking for a new problem
    if (this.isNewProblemRequest(userText)) {
      await this.logAttempt("pending");
    }

    // Track hint if user is asking for help
    const lastAttempt = [
      ...this.sql`SELECT problem_name FROM attempts ORDER BY id DESC LIMIT 1`
    ][0];
    if (this.isHintRequest(userText) && lastAttempt) {
      await this.addHint(lastAttempt.problem_name as string);
    }

    const result = streamText({
      model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
      system: BASE_SYSTEM_PROMPT + this.buildHistoryContext() + (this.getLatestSummary() ? `\n\nLast weekly summary: ${this.getLatestSummary()}` : ""),
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    // Internal route: Workflow fetches problem history
    if (url.pathname === "/get-history" && request.method === "GET") {
      const id = env.ChatAgent.idFromName("default");
      const stub = env.ChatAgent.get(id);
      const rows = await (stub as unknown as { getHistory(): Promise<unknown[]> }).getHistory();
      return Response.json(rows);
    }

    // Internal route: Workflow pushes the weekly summary here
    if (url.pathname === "/store-summary" && request.method === "POST") {
      const { userId, summary } = await request.json<{ userId: string; summary: string }>();
      const id = env.ChatAgent.idFromName(userId);
      const stub = env.ChatAgent.get(id);
      await (stub as unknown as { storeSummary(s: string): Promise<void> }).storeSummary(summary);
      return new Response("ok");
    }

    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },

  // Cron trigger — runs the weekly summary Workflow for each user
  async scheduled(_controller: ScheduledController, env: Env) {
    // For now, run for the default user. In production you'd iterate all users.
    await env.WEEKLY_SUMMARY.create({
      params: { userId: "default" }
    });
  }
} satisfies ExportedHandler<Env>;
