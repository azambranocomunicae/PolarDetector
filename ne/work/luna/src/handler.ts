import type { AnalyzeEnv, AnalyzeRequest, AnalyzeResponse, AnalyzeWindow } from "./contracts.ts";
import { classifyPosts, AiConfigurationError, AiResponseError } from "./ai.ts";
import { BlueskyUpstreamError, fetchAndSelectTrend, toPreview, type FetchLike } from "./bluesky.ts";
import { calculateConcentration, emptyAnalysis } from "./metrics.ts";
import { InvalidTrendUrlError, parseTrendUrl } from "./url.ts";

export interface HandlerDependencies {
  fetchImpl?: FetchLike;
  now?: () => Date;
}

function jsonResponse(body: AnalyzeResponse, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  source: AnalyzeResponse["source"],
  posts: AnalyzeResponse["posts"] = [],
): Response {
  return jsonResponse({ status: "error", source, posts, analysis: null, error: { code, message } }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRequest(value: unknown): AnalyzeRequest {
  if (!isRecord(value) || typeof value.url !== "string") throw new Error("El body debe incluir url");
  if (value.window !== undefined && value.window !== "24h" && value.window !== "7d") {
    throw new Error("window debe ser 24h o 7d");
  }
  return { url: value.url, window: value.window as AnalyzeWindow | undefined };
}

export async function handleAnalyzeRequest(
  request: Request,
  env: AnalyzeEnv = {},
  dependencies: HandlerDependencies = {},
): Promise<Response> {
  const fetchedAt = new Date().toISOString();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "El body debe ser JSON válido", {
      url: "",
      window: "24h",
      fetchedAt,
    });
  }

  let input: AnalyzeRequest;
  try {
    input = parseRequest(body);
  } catch (error) {
    return errorResponse(400, "INVALID_REQUEST", error instanceof Error ? error.message : "Solicitud inválida", {
      url: "",
      window: "24h",
      fetchedAt,
    });
  }

  let parsedUrl;
  try {
    parsedUrl = parseTrendUrl(input.url);
  } catch (error) {
    return errorResponse(400, "INVALID_TREND_URL", error instanceof InvalidTrendUrlError ? error.message : "URL inválida", {
      url: input.url,
      window: input.window ?? "24h",
      fetchedAt,
    });
  }

  const window = input.window ?? "24h";
  const source = { url: parsedUrl.canonicalUrl, window, fetchedAt };
  let fetched;
  try {
    fetched = await fetchAndSelectTrend(parsedUrl, window, new Date(fetchedAt), dependencies.fetchImpl);
  } catch (error) {
    const code = error instanceof BlueskyUpstreamError ? error.code : "BLUESKY_UPSTREAM_ERROR";
    return errorResponse(502, code, error instanceof Error ? error.message : "No se pudo consultar Bluesky", source);
  }

  const posts = fetched.weighted.map(toPreview);
  if (fetched.weighted.length < 5) {
    return jsonResponse(
      {
        status: "insufficient_sample",
        source,
        posts,
        analysis: emptyAnalysis(fetched.weighted, [...fetched.warnings, "Se requieren al menos 5 posts válidos"]),
      },
      200,
    );
  }

  try {
    const ai = await classifyPosts(fetched.weighted, env, dependencies.fetchImpl);
    const analysis = calculateConcentration(fetched.weighted, ai, [
      "Los posts destacados representan visibilidad, no una encuesta de opinión pública",
      "La concentración no demuestra polarización ni antagonismo",
      ...fetched.warnings,
    ]);
    return jsonResponse({ status: analysis.concentration === null ? "insufficient_sample" : "ok", source, posts, analysis }, 200);
  } catch (error) {
    if (error instanceof AiConfigurationError) {
      return jsonResponse(
        {
          status: "config_required",
          source,
          posts,
          analysis: null,
          error: { code: error.code, message: error.message },
        },
        503,
      );
    }
    const code = error instanceof AiResponseError ? error.code : "AI_ERROR";
    return errorResponse(502, code, error instanceof Error ? error.message : "No se pudo analizar la muestra", source, posts);
  }
}
