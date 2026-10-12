import { ThinkingLevel, Type } from "@google/genai";
import { gemini } from "@/lib/ai/gemini";
import { withRetry } from "@/lib/ai/retry";
import type { RouteType } from "@/lib/db/schema";
import type { ChatDoc } from "./context";

export type RouteDecision = {
  type: RouteType;
  /** For general_knowledge: the question rephrased so it can be answered from the document. */
  suggestion?: string;
  /** For chitchat: a one-line reply. */
  reply?: string;
  /** Summaries, overviews and "list all / every" questions: read everything before answering. */
  needs_full_document?: boolean;
};

const SYSTEM = `You classify a user's message in a contract-analysis app. The app answers ONLY from the user's uploaded documents.

Categories:
- "document": anything that could be answered by reading the documents, including follow-ups ("what about clause 5?", "and for the buyer?"), summaries, comparisons, "is there a X clause?", obligations, dates, amounts, risks, and practical questions whose answer depends on the contract ("can I terminate early?", "what if the supplier goes bankrupt?").
- "general_knowledge": a general legal question not about these documents ("what does indemnity mean?", "what is the statute of limitations in the UAE?").
- "off_topic": unrelated to contracts or the documents (weather, coding, jokes, recipes).
- "chitchat": greetings, thanks, small talk.

Rules:
- If unsure, choose "document". Wrongly refusing a real question is worse than answering an unrelated one.
- For "general_knowledge", set "suggestion" to a question about THESE documents the user could ask instead, e.g. "What does the indemnity clause in this agreement cover?".
- For "chitchat", set "reply" to one short friendly sentence that invites a question about the documents.
- For "document", set "needs_full_document" to true when answering requires reading the whole document rather than finding specific passages: summaries, overviews, "what does this contract cover", "list all / every ...", "what are all the obligations / risks / deadlines". Otherwise false.`;

/** Classify the question. Fails open: any error means "document". */
export async function routeQuestion(
  question: string,
  history: { role: string; content: string }[],
  docs: ChatDoc[],
  signal?: AbortSignal,
): Promise<RouteDecision> {
  const recent = history
    .slice(-4)
    .map((m) => `${m.role}: ${m.content.slice(0, 400)}`)
    .join("\n");
  const prompt = `Documents: ${docs.map((d) => `"${d.name}"`).join(", ")}
${recent ? `Recent conversation:\n${recent}\n` : ""}
Message to classify: ${question}`;

  try {
    const res = await withRetry(
      (model) =>
        gemini().models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction: SYSTEM,
            abortSignal: signal,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, enum: ["document", "general_knowledge", "off_topic", "chitchat"] },
                suggestion: { type: Type.STRING },
                reply: { type: Type.STRING },
                needs_full_document: { type: Type.BOOLEAN },
              },
              required: ["type"],
            },
          },
        }),
      signal,
    );
    const parsed = JSON.parse(res.text ?? "{}") as RouteDecision;
    const valid: RouteType[] = ["document", "general_knowledge", "off_topic", "chitchat"];
    return valid.includes(parsed.type) ? parsed : { type: "document" };
  } catch (e) {
    if (signal?.aborted) throw e;
    console.error("Router failed; treating question as a document question", e);
    return { type: "document" };
  }
}

/** The fixed reply for questions the app will not answer. */
export function refusalText(decision: RouteDecision, docs: ChatDoc[]): string {
  const names = docs.length === 1 ? `“${docs[0].name}”` : "your documents";
  switch (decision.type) {
    case "general_knowledge":
      return [
        `That's a general legal question. I only answer from ${names}, so that every answer can be checked against the text.`,
        decision.suggestion ? `\n\nTo see how the document handles it, try: *${decision.suggestion}*` : "",
      ].join("");
    case "off_topic":
      return `I can only answer questions about ${names}. Try asking about a clause, an obligation, a deadline or an amount.`;
    case "chitchat":
      return decision.reply || `Happy to help. Ask me anything about ${names}.`;
    default:
      return "";
  }
}
