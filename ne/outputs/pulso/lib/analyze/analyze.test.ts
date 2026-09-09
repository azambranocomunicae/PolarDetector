import assert from "node:assert/strict";
import test from "node:test";
import type { AnalyzeEnv, AnalyzeResponse, ValidatedAiOutput, WeightedPost } from "./contracts.ts";
import { handleAnalyzeRequest } from "./handler.ts";
import { validateAiOutput } from "./ai.ts";
import { calculateConcentration } from "./metrics.ts";
import { parseTrendUrl } from "./url.ts";

function post(id: number, weight: number): WeightedPost {
  return {
    id,
    weight,
    uri: `at://did:plc:test/app.bsky.feed.post/${id}`,
    text: `post ${id}`,
    authorHandle: `a${id}.bsky.social`,
    authorKey: `a${id}.bsky.social`,
    engagement: 10,
    endorsement: 5,
    metrics: { likes: 5, reposts: 0, replies: 5, quotes: 0 },
    bucket: "top",
    rank: id + 1,
  };
}

function ai(groups: Array<{ label: string; postIds: number[] }>, unknownIds: number[] = []): ValidatedAiOutput {
  return { groups, unknownIds, overallConfidence: 1 };
}

void test("una sola postura concentra el máximo", () => {
  const posts = [0, 1, 2, 3, 4].map((id) => post(id, 0.2));
  const { analysis } = calculateConcentration(posts, ai([{ label: "a favor", postIds: [0, 1, 2, 3, 4] }]));
  assert.equal(analysis.score, 100);
  assert.equal(analysis.level, "high");
  assert.equal(analysis.coverage, 1);
});

void test("dos posturas con el mismo peso dan 50", () => {
  const posts = [0, 1, 2, 3, 4, 5].map((id) => post(id, 1 / 6));
  const { analysis, groupOf } = calculateConcentration(
    posts,
    ai([
      { label: "a favor", postIds: [0, 1, 2] },
      { label: "en contra", postIds: [3, 4, 5] },
    ]),
  );
  assert.equal(analysis.score, 50);
  assert.equal(analysis.level, "medium");
  assert.equal(analysis.groups.length, 2);
  assert.equal(groupOf.get(3), "en-contra");
});

void test("el peso manda: un destacado dominante puntúa alto aunque haya más posts diversos", () => {
  const posts = [post(0, 0.9), post(1, 0.04), post(2, 0.03), post(3, 0.02), post(4, 0.01)];
  const { analysis } = calculateConcentration(
    posts,
    ai([
      { label: "postura dominante", postIds: [0] },
      { label: "otra", postIds: [1, 2] },
      { label: "tercera", postIds: [3, 4] },
    ]),
  );
  assert.equal(analysis.level, "high");
  assert.ok(analysis.score !== null && analysis.score > 80);
});

void test("sin cobertura suficiente no se puntúa", () => {
  const posts = [0, 1, 2, 3, 4].map((id) => post(id, 0.2));
  const { analysis } = calculateConcentration(posts, ai([{ label: "a favor", postIds: [0, 1] }], [2, 3, 4]));
  assert.equal(analysis.score, null);
  assert.equal(analysis.level, "insufficient_data");
  assert.equal(analysis.classifiedPosts, 2);
  assert.ok(analysis.unknownShare > 0.5);
});

void test("solo se aceptan búsquedas, hashtags y feeds de bsky.app", () => {
  assert.equal(parseTrendUrl("https://bsky.app/search?q=clima").query, "clima");
  assert.equal(parseTrendUrl("https://bsky.app/hashtag/clima").query, "#clima");
  assert.throws(() => parseTrendUrl("https://example.com/private"), { code: "INVALID_TREND_URL" });
});

function blueskyStub(count: number) {
  return async (input: string): Promise<Response> => {
    const sort = new URL(input).searchParams.get("sort");
    const posts =
      sort === "top"
        ? Array.from({ length: count }, (_unused, index) => ({
            uri: `at://did:plc:test/app.bsky.feed.post/${index}`,
            author: { handle: `a${index}.bsky.social` },
            record: { text: `opinión ${index}`, createdAt: new Date().toISOString() },
            likeCount: 100 - index,
            repostCount: 1,
            replyCount: 1,
            quoteCount: 0,
          }))
        : [];
    return new Response(JSON.stringify({ posts }), { headers: { "content-type": "application/json" } });
  };
}

void test("la ruta responde ok y etiqueta cada post con su postura", async () => {
  const env: AnalyzeEnv = {
    AI: {
      run: async () =>
        JSON.stringify({
          groups: [
            { label: "a favor", postIds: [0, 1, 2] },
            { label: "en contra", postIds: [3, 4, 5] },
          ],
          unknownIds: [],
          overallConfidence: 0.8,
        }),
    },
  };
  const request = new Request("https://pulso.test/api/analyze", {
    method: "POST",
    body: JSON.stringify({ url: "https://bsky.app/search?q=clima", window: "24h" }),
  });
  const response = await handleAnalyzeRequest(request, env, { fetchImpl: blueskyStub(6) });
  const body = (await response.json()) as AnalyzeResponse;

  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.query, "clima");
  assert.equal(body.posts.length, 6);
  assert.ok(body.posts.every((item) => item.groupId));
  assert.ok(body.analysis !== null && body.analysis.score !== null && body.analysis.score > 0);
});

void test("una muestra corta no se puntúa y lo explica", async () => {
  const request = new Request("https://pulso.test/api/analyze", {
    method: "POST",
    body: JSON.stringify({ url: "https://bsky.app/search?q=clima" }),
  });
  const response = await handleAnalyzeRequest(request, {}, { fetchImpl: blueskyStub(2) });
  const body = (await response.json()) as AnalyzeResponse;

  assert.equal(body.status, "insufficient_data");
  assert.equal(body.analysis?.score, null);
  assert.match(String(body.analysis?.explanation), /al menos 5/);
});

void test("sin credenciales de IA se devuelven los posts y config_required", async () => {
  const request = new Request("https://pulso.test/api/analyze", {
    method: "POST",
    body: JSON.stringify({ url: "https://bsky.app/search?q=clima" }),
  });
  const response = await handleAnalyzeRequest(request, {}, { fetchImpl: blueskyStub(6) });
  const body = (await response.json()) as AnalyzeResponse;

  assert.equal(response.status, 503);
  assert.equal(body.status, "config_required");
  assert.equal(body.posts.length, 6);
  assert.equal(body.error?.code, "AI_CONFIG_REQUIRED");
});

void test("una URL inválida no llega a Bluesky", async () => {
  const request = new Request("https://pulso.test/api/analyze", {
    method: "POST",
    body: JSON.stringify({ url: "https://example.com/private" }),
  });
  const response = await handleAnalyzeRequest(request, {}, {
    fetchImpl: () => {
      throw new Error("no debería consultar Bluesky");
    },
  });
  const body = (await response.json()) as AnalyzeResponse;

  assert.equal(response.status, 400);
  assert.equal(body.status, "invalid_request");
  assert.equal(body.error?.code, "INVALID_TREND_URL");
});

void test("el ruido del modelo no tumba el análisis: ids inventados, repetidos y etiquetas duplicadas", () => {
  const output = validateAiOutput(
    JSON.stringify({
      groups: [
        { label: "A favor", postIds: [0, 1, 99, 1] },
        { label: "a favor", postIds: [2], description: " se repite la etiqueta " },
        { label: "en contra", postIds: [3, "4"] },
        { label: "vacío tras filtrar", postIds: [0, 999] },
        { label: "", postIds: [4] },
      ],
      unknownIds: [4, 0, -1],
      overallConfidence: 7,
    }),
    5,
  );

  assert.deepEqual(
    output.groups.map((group) => [group.label, group.postIds]),
    [
      ["A favor", [0, 1, 2]],
      ["en contra", [3]],
    ],
  );
  assert.deepEqual(output.unknownIds, [4]);
  assert.equal(output.overallConfidence, 0.5);
});

void test("una respuesta sin nada usable sí falla", () => {
  assert.throws(() => validateAiOutput('{"groups":[],"unknownIds":[]}', 5), { code: "AI_INVALID_RESPONSE" });
  assert.throws(() => validateAiOutput("no soy json", 5), { code: "AI_INVALID_RESPONSE" });
});

void test("acepta la salida estructurada de Workers AI, que llega como objeto", async () => {
  const env: AnalyzeEnv = {
    AI: {
      run: async () => ({
        response: {
          groups: [
            { label: "a favor", postIds: [0, 1, 2] },
            { label: "en contra", postIds: [3, 4, 5] },
          ],
          unknownIds: [],
          overallConfidence: 0.9,
        },
      }),
    },
  };
  const request = new Request("https://pulso.test/api/analyze", {
    method: "POST",
    body: JSON.stringify({ url: "https://bsky.app/search?q=clima" }),
  });
  const body = (await (await handleAnalyzeRequest(request, env, { fetchImpl: blueskyStub(6) })).json()) as AnalyzeResponse;

  assert.equal(body.status, "ok");
  assert.equal(body.analysis?.groups.length, 2);
});
