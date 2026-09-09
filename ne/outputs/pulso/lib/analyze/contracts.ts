export type AnalyzeWindow = "24h" | "7d";

export interface AnalyzeRequest {
  url: string;
  window?: AnalyzeWindow;
}

export type AnalysisStatus =
  | "ok"
  | "config_required"
  | "insufficient_data"
  | "upstream_error"
  | "invalid_request"
  | "rate_limited";

export interface PostPreview {
  id: number;
  uri: string;
  url?: string;
  source: "top" | "latest";
  rank: number;
  weight: number;
  author: { handle: string; displayName?: string };
  text: string;
  createdAt: string;
  metrics: { likes: number; reposts: number; replies: number; quotes: number };
  groupId?: string;
}

export interface AnalysisGroup {
  id: string;
  label: string;
  description: string;
  share: number;
  postCount: number;
}

export interface AnalysisResult {
  score: number | null;
  level: "high" | "medium" | "low" | "insufficient_data";
  dominantGroupId: string | null;
  groups: AnalysisGroup[];
  coverage: number;
  unknownShare: number;
  classifiedPosts: number;
  totalPosts: number;
  confidence: number;
  explanation: string;
  method: string;
}

export interface AnalyzeResponse {
  status: AnalysisStatus;
  query: string;
  window: AnalyzeWindow;
  fetchedAt: string;
  posts: PostPreview[];
  analysis: AnalysisResult | null;
  warnings: string[];
  error?: { code: string; message: string };
}

export interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

/** Binding nativo de rate limiting de Cloudflare. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface AnalyzeEnv {
  AI?: AiBinding;
  ANALYZE_LIMITER?: RateLimiter;
  AI_MODEL?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
}

export interface InternalPost {
  uri: string;
  text: string;
  authorHandle?: string;
  authorDisplayName?: string;
  authorKey: string;
  createdAt?: string;
  engagement: number;
  endorsement: number;
  metrics: { likes: number; reposts: number; replies: number; quotes: number };
  bucket: "top" | "latest";
  rank: number;
}

export interface ParsedFeedUrl {
  actor: string;
  feedRkey: string;
}

export interface WeightedPost extends InternalPost {
  id: number;
  weight: number;
}

export interface AiGroup {
  label: string;
  postIds: number[];
  confidence?: number;
  description?: string;
}

export interface ValidatedAiOutput {
  groups: AiGroup[];
  unknownIds: number[];
  overallConfidence: number;
}
