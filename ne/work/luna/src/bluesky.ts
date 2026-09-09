import type { InternalPost, PostPreview, WeightedPost } from "./contracts.ts";
import type { AnalyzeWindow } from "./contracts.ts";
import type { ParsedTrendUrl } from "./url.ts";

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<Response>;

const SEARCH_ENDPOINT = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts";
const TOP_LIMIT = 60;
const LATEST_LIMIT = 20;
const TOP_RETAIN = 50;
const LATEST_RETAIN = 20;
const TOP_MASS = 0.95;
const LATEST_MASS = 0.05;

interface SourcePost {
  uri?: unknown;
  text?: unknown;
  record?: unknown;
  author?: unknown;
  indexedAt?: unknown;
  likeCount?: unknown;
  replyCount?: unknown;
  repostCount?: unknown;
  quoteCount?: unknown;
}

interface SearchResponse {
  posts?: unknown;
}

interface FeedResponse {
  feed?: unknown;
}

export class BlueskyUpstreamError extends Error {
  readonly code = "BLUESKY_UPSTREAM_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "BlueskyUpstreamError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function normalizedText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizePost(source: SourcePost, bucket: "top" | "latest", rank: number): InternalPost | null {
  const record = isRecord(source.record) ? source.record : {};
  const text = stringValue(source.text) ?? stringValue(record.text);
  const uri = stringValue(source.uri);
  if (!text || !uri) return null;

  const author = isRecord(source.author) ? source.author : {};
  const authorHandle = stringValue(author.handle);
  const authorDisplayName = stringValue(author.displayName);
  const authorKey = authorHandle ?? uri;
  const createdAt = stringValue(record.createdAt) ?? stringValue(source.indexedAt);
  const engagement =
    nonNegativeNumber(source.likeCount) +
    nonNegativeNumber(source.replyCount) +
    nonNegativeNumber(source.repostCount) +
    nonNegativeNumber(source.quoteCount);
  const endorsement = nonNegativeNumber(source.likeCount) + nonNegativeNumber(source.repostCount);
  const metrics = {
    likes: nonNegativeNumber(source.likeCount),
    reposts: nonNegativeNumber(source.repostCount),
    replies: nonNegativeNumber(source.replyCount),
    quotes: nonNegativeNumber(source.quoteCount),
  };

  return { uri, text, authorHandle, authorDisplayName, authorKey, createdAt, engagement, endorsement, metrics, bucket, rank };
}

function parseSourcePosts(body: unknown, bucket: "top" | "latest"): InternalPost[] {
  if (!isRecord(body) || !Array.isArray(body.posts)) {
    throw new BlueskyUpstreamError("La respuesta de Bluesky no contiene posts");
  }

  return body.posts
    .map((post, index) => (isRecord(post) ? normalizePost(post as SourcePost, bucket, index + 1) : null))
    .filter((post): post is InternalPost => post !== null);
}

function keyFor(post: InternalPost): string {
  return `${post.uri}\u0000${normalizedText(post.text)}`;
}

function dedupe(posts: InternalPost[], seen: Set<string>): InternalPost[] {
  const result: InternalPost[] = [];
  const localUris = new Set<string>();
  const localTexts = new Set<string>();

  for (const post of posts) {
    const textKey = normalizedText(post.text);
    if (seen.has(post.uri) || seen.has(`text:${textKey}`) || localUris.has(post.uri) || localTexts.has(textKey)) {
      continue;
    }
    localUris.add(post.uri);
    localTexts.add(textKey);
    seen.add(post.uri);
    seen.add(`text:${textKey}`);
    seen.add(keyFor(post));
    result.push(post);
  }

  return result;
}

export interface SelectedPosts {
  posts: InternalPost[];
  topCount: number;
  latestCount: number;
  warnings: string[];
}

export function selectPosts(top: InternalPost[], latest: InternalPost[]): SelectedPosts {
  const seen = new Set<string>();
  const topUnique = dedupe(top, seen).slice(0, TOP_RETAIN).map((post, index) => ({ ...post, bucket: "top" as const, rank: index + 1 }));
  const latestUnique = dedupe(latest, seen)
    .slice(0, LATEST_RETAIN)
    .map((post, index) => ({ ...post, bucket: "latest" as const, rank: index + 1 }));

  const authorCounts = new Map<string, number>();
  const selected: InternalPost[] = [];
  for (const post of [...topUnique, ...latestUnique]) {
    const count = authorCounts.get(post.authorKey) ?? 0;
    if (count >= 2) continue;
    authorCounts.set(post.authorKey, count + 1);
    selected.push(post);
  }

  return {
    posts: selected,
    topCount: selected.filter((post) => post.bucket === "top").length,
    latestCount: selected.filter((post) => post.bucket === "latest").length,
    warnings: [],
  };
}

function rawInternalWeight(post: InternalPost): number {
  const rankFactor = 1 / Math.pow(Math.max(1, post.rank), 0.7);
  const boundedEngagement = Math.min(1, Math.log1p(post.engagement) / Math.log1p(10_000));
  return rankFactor * (0.85 + 0.15 * boundedEngagement);
}

export function applyWeights(posts: InternalPost[]): WeightedPost[] {
  const top = posts.filter((post) => post.bucket === "top");
  const latest = posts.filter((post) => post.bucket === "latest");
  const topRaw = top.map(rawInternalWeight);
  const latestRaw = latest.map(rawInternalWeight);
  const topTotal = topRaw.reduce((sum, value) => sum + value, 0);
  const latestTotal = latestRaw.reduce((sum, value) => sum + value, 0);
  const topMass = topTotal > 0 && latestTotal > 0 ? TOP_MASS : topTotal > 0 ? 1 : 0;
  const latestMass = topTotal > 0 && latestTotal > 0 ? LATEST_MASS : latestTotal > 0 ? 1 : 0;

  let id = 0;
  return [
    ...top.map((post, index) => ({ ...post, id: id++, weight: (topMass * topRaw[index]) / topTotal })),
    ...latest.map((post, index) => ({ ...post, id: id++, weight: (latestMass * latestRaw[index]) / latestTotal })),
  ];
}

function windowBounds(window: AnalyzeWindow, now: Date): { since: string; until: string } {
  const duration = window === "7d" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return { since: new Date(now.getTime() - duration).toISOString(), until: now.toISOString() };
}

async function fetchSearch(
  query: string,
  sort: "top" | "latest",
  limit: number,
  window: AnalyzeWindow,
  now: Date,
  fetchImpl: FetchLike,
): Promise<InternalPost[]> {
  const url = new URL(SEARCH_ENDPOINT);
  const bounds = windowBounds(window, now);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", sort);
  url.searchParams.set("since", bounds.since);
  url.searchParams.set("until", bounds.until);

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new BlueskyUpstreamError(`No se pudo consultar Bluesky: ${error instanceof Error ? error.message : "error de red"}`);
  }
  if (!response.ok) {
    throw new BlueskyUpstreamError(`Bluesky respondió HTTP ${response.status}`);
  }

  let body: unknown;
  try {
    body = (await response.json()) as SearchResponse;
  } catch {
    throw new BlueskyUpstreamError("Bluesky devolvió JSON inválido");
  }
  return parseSourcePosts(body, sort);
}

export async function fetchAndSelectPosts(
  query: string,
  window: AnalyzeWindow,
  now: Date,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<SelectedPosts & { weighted: WeightedPost[] }> {
  const [top, latest] = await Promise.all([
    fetchSearch(query, "top", TOP_LIMIT, window, now, fetchImpl),
    fetchSearch(query, "latest", LATEST_LIMIT, window, now, fetchImpl),
  ]);
  const selected = selectPosts(top, latest);
  return { ...selected, weighted: applyWeights(selected.posts) };
}

const FEED_ENDPOINT = "https://api.bsky.app/xrpc/app.bsky.feed.getFeed";
const RESOLVE_HANDLE_ENDPOINT = "https://api.bsky.app/xrpc/com.atproto.identity.resolveHandle";

function feedDuration(window: AnalyzeWindow): number {
  return (window === "7d" ? 7 : 1) * 24 * 60 * 60 * 1000;
}

function isWithinWindow(post: InternalPost, now: Date, window: AnalyzeWindow): boolean {
  if (!post.createdAt) return true;
  const created = Date.parse(post.createdAt);
  return !Number.isFinite(created) || created >= now.getTime() - feedDuration(window);
}

async function getJson(
  url: string,
  fetchImpl: FetchLike,
  errorPrefix: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new BlueskyUpstreamError(`${errorPrefix}: ${error instanceof Error ? error.message : "error de red"}`);
  }
  if (!response.ok) throw new BlueskyUpstreamError(`${errorPrefix}: HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new BlueskyUpstreamError(`${errorPrefix}: JSON inválido`);
  }
}

async function resolveActor(actor: string, fetchImpl: FetchLike): Promise<string> {
  if (actor.startsWith("did:")) return actor;
  const url = new URL(RESOLVE_HANDLE_ENDPOINT);
  url.searchParams.set("handle", actor);
  const body = await getJson(url.toString(), fetchImpl, "No se pudo resolver el handle");
  if (!isRecord(body) || typeof body.did !== "string" || !/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(body.did)) {
    throw new BlueskyUpstreamError("El resolver no devolvió un DID válido");
  }
  return body.did;
}

function feedItemPost(item: unknown): SourcePost | null {
  if (!isRecord(item)) return null;
  const post = isRecord(item.post) ? item.post : item;
  return post as SourcePost;
}

function feedPosts(body: unknown, now: Date, window: AnalyzeWindow): InternalPost[] {
  if (!isRecord(body) || !Array.isArray(body.feed)) throw new BlueskyUpstreamError("La respuesta del feed no contiene posts");
  const normalized = body.feed
    .map(feedItemPost)
    .filter((post): post is SourcePost => post !== null)
    .map((post, index) => normalizePost(post, "latest", index + 1))
    .filter((post): post is InternalPost => post !== null)
    .filter((post) => isWithinWindow(post, now, window));

  return normalized.sort((left, right) => {
    const leftEndorsement = left.endorsement;
    const rightEndorsement = right.endorsement;
    if (rightEndorsement !== leftEndorsement) return rightEndorsement - leftEndorsement;
    const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
    const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return left.uri.localeCompare(right.uri);
  });
}

export async function fetchAndSelectFeed(
  feed: { actor: string; feedRkey: string },
  window: AnalyzeWindow,
  now: Date,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<SelectedPosts & { weighted: WeightedPost[] }> {
  const did = await resolveActor(feed.actor, fetchImpl);
  const feedUri = `at://${did}/app.bsky.feed.generator/${feed.feedRkey}`;
  const url = new URL(FEED_ENDPOINT);
  url.searchParams.set("feed", feedUri);
  url.searchParams.set("limit", "100");
  const selected = selectPosts(feedPosts(await getJson(url.toString(), fetchImpl, "No se pudo consultar el feed"), now, window), []);
  const withWarning = {
    ...selected,
    warnings: ["El orden del feed se usa como proxy de engagement visible y no representa un ranking global"],
  };
  return { ...withWarning, weighted: applyWeights(withWarning.posts) };
}

export async function fetchAndSelectTrend(
  trend: ParsedTrendUrl,
  window: AnalyzeWindow,
  now: Date,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<SelectedPosts & { weighted: WeightedPost[] }> {
  if (trend.kind === "feed" && trend.feed) return fetchAndSelectFeed(trend.feed, window, now, fetchImpl);
  return fetchAndSelectPosts(trend.query, window, now, fetchImpl);
}

export function toPreview(post: WeightedPost): PostPreview {
  const postPath = post.uri.split("/").pop();
  const profileUrl = post.authorHandle && postPath ? `https://bsky.app/profile/${post.authorHandle}/post/${postPath}` : undefined;
  return {
    id: post.id,
    uri: post.uri,
    ...(profileUrl ? { url: profileUrl } : {}),
    source: post.bucket,
    rank: post.rank,
    weight: post.weight,
    author: {
      handle: post.authorHandle ?? "",
      ...(post.authorDisplayName ? { displayName: post.authorDisplayName } : {}),
    },
    text: post.text,
    createdAt: post.createdAt ?? "",
    metrics: post.metrics,
  };
}
