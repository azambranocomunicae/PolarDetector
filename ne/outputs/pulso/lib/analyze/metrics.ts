import type { AnalysisGroup, AnalysisResult, ValidatedAiOutput, WeightedPost } from "./contracts.ts";

const MIN_CLASSIFIED_POSTS = 5;
const MIN_COVERAGE = 0.6;
const HIGH_SCORE = 60;
const MEDIUM_SCORE = 35;

export const METHOD =
  "Índice de concentración HHI: 100 × suma(peso relativo de cada postura)². Los posts destacados aportan el 95 % del peso y la muestra reciente el 5 %.";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function percent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

function displayLabel(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function uniqueSlug(label: string, taken: Set<string>): string {
  const base =
    label
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 40) || "postura";
  let slug = base;
  let suffix = 2;
  while (taken.has(slug)) slug = `${base}-${suffix++}`;
  taken.add(slug);
  return slug;
}

export function emptyAnalysis(posts: WeightedPost[], explanation: string): AnalysisResult {
  return {
    score: null,
    level: "insufficient_data",
    dominantGroupId: null,
    groups: [],
    coverage: 0,
    unknownShare: posts.length > 0 ? 1 : 0,
    classifiedPosts: 0,
    totalPosts: posts.length,
    confidence: 0,
    explanation,
    method: METHOD,
  };
}

export interface Concentration {
  analysis: AnalysisResult;
  /** id de postura por id de post, para etiquetar la muestra en la interfaz. */
  groupOf: Map<number, string>;
}

export function calculateConcentration(posts: WeightedPost[], ai: ValidatedAiOutput): Concentration {
  const weightById = new Map(posts.map((post) => [post.id, post.weight]));
  const totalWeight = posts.reduce((sum, post) => sum + post.weight, 0);
  const groupOf = new Map<number, string>();
  const taken = new Set<string>();

  const weighted = ai.groups.map((group) => {
    const id = uniqueSlug(group.label, taken);
    let weight = 0;
    for (const postId of group.postIds) {
      weight += weightById.get(postId) ?? 0;
      groupOf.set(postId, id);
    }
    return {
      id,
      label: displayLabel(group.label),
      description: group.description ?? `Agrupa ${group.postIds.length} posts con esta postura.`,
      postCount: group.postIds.length,
      weight,
    };
  });

  const classifiedWeight = weighted.reduce((sum, group) => sum + group.weight, 0);
  const classifiedPosts = weighted.reduce((sum, group) => sum + group.postCount, 0);
  const coverage = totalWeight > 0 ? clamp01(classifiedWeight / totalWeight) : 0;
  const unknownShare = clamp01(1 - coverage);

  const groups: AnalysisGroup[] = weighted
    .map(({ id, label, description, postCount, weight }) => ({
      id,
      label,
      description,
      postCount,
      share: classifiedWeight > 0 ? weight / classifiedWeight : 0,
    }))
    .sort((left, right) => right.share - left.share || left.label.localeCompare(right.label));

  const scorable = groups.length > 0 && classifiedPosts >= MIN_CLASSIFIED_POSTS && coverage >= MIN_COVERAGE;
  const hhi = 100 * groups.reduce((sum, group) => sum + group.share * group.share, 0);
  const dominant = groups[0];

  const level: AnalysisResult["level"] = !scorable
    ? "insufficient_data"
    : hhi >= HIGH_SCORE
      ? "high"
      : hhi >= MEDIUM_SCORE
        ? "medium"
        : "low";

  const levelNote =
    level === "high"
      ? "Concentración alta: poca diversidad de opiniones entre los posts destacados."
      : level === "medium"
        ? "Concentración media: hay una postura predominante junto a otras minoritarias."
        : "Concentración baja: la muestra recoge varias posturas con pesos parecidos.";

  const explanation = scorable
    ? `${groups.length} ${groups.length === 1 ? "postura identificada" : "posturas identificadas"}; «${dominant.label}» concentra el ${percent(dominant.share)} del peso clasificado. ${levelNote}`
    : `Sin puntuación: ${classifiedPosts} posts con postura identificable y ${percent(coverage)} de cobertura ponderada, por debajo del mínimo de ${MIN_CLASSIFIED_POSTS} posts y ${percent(MIN_COVERAGE)}.`;

  return {
    analysis: {
      score: scorable ? Math.round(hhi * 10) / 10 : null,
      level,
      dominantGroupId: scorable ? dominant.id : null,
      groups,
      coverage,
      unknownShare,
      classifiedPosts,
      totalPosts: posts.length,
      confidence: clamp01(ai.overallConfidence * coverage),
      explanation,
      method: METHOD,
    },
    groupOf,
  };
}
