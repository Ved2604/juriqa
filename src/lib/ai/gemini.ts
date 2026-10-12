import { GoogleGenAI } from "@google/genai";
import { env } from "@/lib/env";

let client: GoogleGenAI | undefined;

export function gemini(): GoogleGenAI {
  if (!client) {
    const { GEMINI_API_KEY, GEMINI_BASE_URL } = env();
    client = new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
      ...(GEMINI_BASE_URL ? { httpOptions: { baseUrl: GEMINI_BASE_URL } } : {}),
    });
  }
  return client;
}

export function model(): string {
  return env().GEMINI_MODEL;
}
