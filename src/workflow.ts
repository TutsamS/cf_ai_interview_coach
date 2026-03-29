import { WorkflowEntrypoint, WorkflowStep } from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";

type SummaryParams = {
  userId: string;
};

export class WeeklySummaryWorkflow extends WorkflowEntrypoint<
  Env,
  SummaryParams
> {
  async run(event: WorkflowEvent<SummaryParams>, step: WorkflowStep) {
    const { userId } = event.payload;

    // Step 1 — Fetch the user's problem history from their Durable Object
    const history = await step.do("fetch-history", async () => {
      const id = this.env.ChatAgent.idFromName(userId);
      const stub = this.env.ChatAgent.get(id);
      const res = await stub.fetch("https://internal/get-history");
      return res.json<
        Array<{ problem_name: string; hints_used: number; solved: number }>
      >();
    });

    // Step 2 — Generate the summary using Workers AI
    // If this step fails, the Workflow retries from here, not from the beginning
    const summary = await step.do("generate-summary", async () => {
      if (history.length === 0) {
        return "No problems attempted this week. Keep practicing!";
      }

      const solved = history.filter((a) => a.solved).length;
      const totalHints = history.reduce((sum, a) => sum + a.hints_used, 0);
      const problemList = history
        .map(
          (a) =>
            `- ${a.problem_name}: ${a.solved ? "solved" : "attempted"}, ${a.hints_used} hints`
        )
        .join("\n");

      const prompt = `You are a coding interview coach. Write a short, encouraging weekly performance summary (3-4 sentences) for a student based on this data:

Problems this week:
${problemList}

Stats: ${solved}/${history.length} solved, ${totalHints} total hints used.

Be specific, mention strong areas and one area to improve. Keep it under 100 words.`;

      const response = await this.env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        { messages: [{ role: "user", content: prompt }] }
      );

      return (
        (response as { response?: string }).response ??
        "Unable to generate summary."
      );
    });

    // Step 3 — Store the summary back in the Durable Object
    // Separated so a storage failure doesn't re-run the LLM call
    await step.do("store-summary", async () => {
      const id = this.env.ChatAgent.idFromName(userId);
      const stub = this.env.ChatAgent.get(id);
      await stub.fetch("https://internal/store-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary })
      });
    });
  }
}
