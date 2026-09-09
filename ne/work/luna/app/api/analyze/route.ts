import { handleAnalyzeRequest } from "../../../src/handler.ts";
import type { AnalyzeEnv } from "../../../src/contracts.ts";

export const runtime = "edge";

interface RouteContext {
  env?: AnalyzeEnv;
  platform?: { env?: AnalyzeEnv };
}

function runtimeEnv(context: RouteContext | undefined): AnalyzeEnv {
  if (context?.env) return context.env;
  if (context?.platform?.env) return context.platform.env;

  const globals = globalThis as typeof globalThis & {
    __CF_ENV__?: AnalyzeEnv;
    process?: { env?: Record<string, string | undefined> };
  };
  if (globals.__CF_ENV__) return globals.__CF_ENV__;
  return {
    AI_MODEL: globals.process?.env?.AI_MODEL,
    CLOUDFLARE_ACCOUNT_ID: globals.process?.env?.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: globals.process?.env?.CLOUDFLARE_API_TOKEN,
  };
}

export async function POST(request: Request, context?: RouteContext): Promise<Response> {
  return handleAnalyzeRequest(request, runtimeEnv(context));
}
