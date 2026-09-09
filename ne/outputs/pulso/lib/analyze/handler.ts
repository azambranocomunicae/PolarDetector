import type { AnalyzeEnv, AnalyzeRequest, AnalyzeResponse, AnalyzeWindow, PostPreview } from "./contracts.ts";
import { classifyPosts, AiConfigurationError, AiResponseError } from "./ai.ts";
import { BlueskyUpstreamError, fetchAndSelectTrend, toPreview, type FetchLike } from "./bluesky.ts";
import { calculateConcentration, emptyAnalysis } from "./metrics.ts";
import { InvalidTrendUrlError, parseTrendUrl } from "./url.ts";

const MIN_POSTS = 5;
const LOW_COVERAGE = 0.75;
const BASE_WARNINGS = [
  "Los posts destacados representan visibilidad, no una encuesta de opinión pública",
  "La concentración mide poca diversidad de opiniones, no antagonismo entre bandos",
];

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
  body: Pick<AnalyzeResponse, "status" | "query" | "window" | "fetchedAt"> & { posts?: PostPreview[]; warnings?: string[] },
  code: string,
  message: string,
): Response {
  return jsonResponse(
    {
      ...body,
      posts: body.posts ?? [],
      analysis: null,
      warnings: body.warnings ?? [],
      error: { code, message },
    },
    status,
  );
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
  const now = dependencies.now?.() ?? new Date();
  const fetchedAt = now.toISOString();

  let input: AnalyzeRequest;
  try {
    input = parseRequest(await request.json());
  } catch (error) {
    return errorResponse(
      400,
      { status: "invalid_request", query: "", window: "24h", fetchedAt },
      "INVALID_REQUEST",
      error instanceof Error ? error.message : "El body debe ser JSON válido",
    );
  }

  const window = input.window ?? "24h";
  let trend;
  try {
    trend = parseTrendUrl(input.url);
  } catch (error) {
    return errorResponse(
      400,
      { status: "invalid_request", query: input.url.slice(0, 2048), window, fetchedAt },
      "INVALID_TREND_URL",
      error instanceof InvalidTrendUrlError ? error.message : "URL inválida",
    );
  }

  const query = trend.query || trend.canonicalUrl;
  let fetched;
  try {
    fetched = await fetchAndSelectTrend(trend, window, now, dependencies.fetchImpl);
  } catch (error) {
    return errorResponse(
      502,
      { status: "upstream_error", query, window, fetchedAt },
      error instanceof BlueskyUpstreamError ? error.code : "BLUESKY_UPSTREAM_ERROR",
      error instanceof Error ? error.message : "No se pudo consultar Bluesky",
    );
  }

  const posts = fetched.weighted.map(toPreview);
  const warnings = [...BASE_WARNINGS, ...fetched.warnings];

  if (fetched.weighted.length < MIN_POSTS) {
    return jsonResponse(
      {
        status: "insufficient_data",
        query,
        window,
        fetchedAt,
        posts,
        analysis: emptyAnalysis(
          fetched.weighted,
          `La muestra tiene ${fetched.weighted.length} posts válidos y se requieren al menos ${MIN_POSTS}.`,
        ),
        warnings: [...warnings, "Amplía el periodo o usa una consulta con más actividad"],
      },
      200,
    );
  }

  try {
    const ai = await classifyPosts(fetched.weighted, env, query, dependencies.fetchImpl);
    const { analysis, groupOf } = calculateConcentration(fetched.weighted, ai);
    const labelled = fetched.weighted.map((post) => {
      const groupId = groupOf.get(post.id);
      return groupId ? { ...toPreview(post), groupId } : toPreview(post);
    });
    if (analysis.unknownShare > 1 - LOW_COVERAGE) {
      warnings.push(`El ${Math.round(analysis.unknownShare * 100)} % del peso quedó sin postura identificable`);
    }
    return jsonResponse(
      {
        status: analysis.score === null ? "insufficient_data" : "ok",
        query,
        window,
        fetchedAt,
        posts: labelled,
        analysis,
        warnings,
      },
      200,
    );
  } catch (error) {
    if (error instanceof AiConfigurationError) {
      return errorResponse(
        503,
        { status: "config_required", query, window, fetchedAt, posts, warnings },
        error.code,
        error.message,
      );
    }
    return errorResponse(
      502,
      { status: "upstream_error", query, window, fetchedAt, posts, warnings },
      error instanceof AiResponseError ? error.code : "AI_ERROR",
      error instanceof Error ? error.message : "No se pudo analizar la muestra",
    );
  }
}
