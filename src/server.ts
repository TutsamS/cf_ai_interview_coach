import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { streamText, convertToModelMessages, pruneMessages } from "ai";

const SYSTEM_PROMPT = `You are an expert coding interview coach. Your job is to help users practice technical interviews using the Socratic method.

When a user gives you a coding problem (or asks for one):
1. If they ask for a problem, pick an appropriate LeetCode-style problem based on their stated skill level or default to medium difficulty.
2. Ask clarifying questions before giving hints — make the user think first.
3. Never give away the full solution. Instead, give progressively more specific hints only when the user is stuck.
4. Push back if the user proposes a suboptimal approach — ask them to think about time/space complexity.
5. When the user submits a solution, evaluate it: correctness, edge cases, time complexity, space complexity.
6. Be encouraging but honest. If an approach is wrong, say so clearly and guide them toward the right path.

Keep responses concise. One hint at a time. Make the user do the thinking.`;

export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
      system: SYSTEM_PROMPT,
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
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
