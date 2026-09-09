const BSKY_ORIGIN = "https://bsky.app";

export interface ParsedTrendUrl {
  canonicalUrl: string;
  query: string;
  kind: "search" | "hashtag" | "feed";
  feed?: { actor: string; feedRkey: string };
}

export class InvalidTrendUrlError extends Error {
  readonly code = "INVALID_TREND_URL";

  constructor(message = "La URL debe ser una búsqueda o hashtag de bsky.app") {
    super(message);
    this.name = "InvalidTrendUrlError";
  }
}

export function parseTrendUrl(input: unknown): ParsedTrendUrl {
  if (typeof input !== "string" || input.trim() === "") {
    throw new InvalidTrendUrlError();
  }

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new InvalidTrendUrlError();
  }

  if (
    url.origin !== BSKY_ORIGIN ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.hash !== ""
  ) {
    throw new InvalidTrendUrlError();
  }

  if (url.pathname === "/search") {
    const keys = Array.from(url.searchParams.keys());
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (keys.length !== 1 || keys[0] !== "q" || query === "") {
      throw new InvalidTrendUrlError("La búsqueda debe incluir exactamente un parámetro q");
    }

    return {
      canonicalUrl: `${BSKY_ORIGIN}/search?q=${encodeURIComponent(query)}`,
      query,
      kind: "search",
    };
  }

  const match = /^\/hashtag\/([^/]+)$/.exec(url.pathname);
  if (match && !url.search) {
    let tag: string;
    try {
      tag = decodeURIComponent(match[1]);
    } catch {
      throw new InvalidTrendUrlError();
    }

    if (!/^[\p{L}\p{N}_-]+$/u.test(tag)) {
      throw new InvalidTrendUrlError("El hashtag contiene caracteres no permitidos");
    }

    return {
      canonicalUrl: `${BSKY_ORIGIN}/hashtag/${encodeURIComponent(tag)}`,
      query: `#${tag}`,
      kind: "hashtag",
    };
  }

  const feedMatch = /^\/profile\/([^/]+)\/feed\/([^/]+)$/.exec(url.pathname);
  if (feedMatch && !url.search) {
    let actor: string;
    let feedRkey: string;
    try {
      actor = decodeURIComponent(feedMatch[1]);
      feedRkey = decodeURIComponent(feedMatch[2]);
    } catch {
      throw new InvalidTrendUrlError();
    }

    const validDid = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(actor);
    const validHandle = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(actor);
    if ((!validDid && !validHandle) || !/^[A-Za-z0-9._~-]+$/.test(feedRkey)) {
      throw new InvalidTrendUrlError("El perfil o feed no tiene un formato válido");
    }

    return {
      canonicalUrl: `${BSKY_ORIGIN}/profile/${encodeURIComponent(actor)}/feed/${encodeURIComponent(feedRkey)}`,
      query: "",
      kind: "feed",
      feed: { actor, feedRkey },
    };
  }

  throw new InvalidTrendUrlError();
}
