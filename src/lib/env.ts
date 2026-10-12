import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is not set"),
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is not set"),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.8-flash"),
  GEMINI_BASE_URL: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

// Validated lazily so a missing key fails the request that needs it,
// not the whole build.
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse({
      ...process.env,
      GEMINI_BASE_URL: process.env.GEMINI_BASE_URL || undefined,
      GEMINI_MODEL: process.env.GEMINI_MODEL || undefined,
    });
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join("; ");
      throw new Error(`Invalid environment: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
