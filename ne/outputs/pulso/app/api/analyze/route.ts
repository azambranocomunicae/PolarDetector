import { env } from "cloudflare:workers";
import type { AnalyzeEnv } from "@/lib/analyze/contracts.ts";
import { handleAnalyzeRequest } from "@/lib/analyze/handler.ts";

export async function POST(request: Request): Promise<Response> {
  return handleAnalyzeRequest(request, env as unknown as AnalyzeEnv);
}
