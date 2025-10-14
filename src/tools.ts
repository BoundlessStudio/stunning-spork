import fetch, { Response } from "node-fetch";
import * as cheerio from "cheerio";
import { extractDomain } from "./util/url";
import { ColorEntry, dedupeColors, normalizeColor } from "./util/color";

const REQUEST_TIMEOUT_MS = 10_000;

type AbortableFetchOptions = Parameters<typeof fetch>[1];

function withTimeout(url: string, init?: AbortableFetchOptions) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const mergedInit: AbortableFetchOptions = {
    ...init,
    signal: controller.signal,
  };

  const cleanup = () => clearTimeout(timeout);

  return {
    fetchPromise: fetch(url, mergedInit).finally(cleanup),
    controller,
  };
}

export interface BrandfetchNormalizedColor extends ColorEntry {
  source: "brandfetch";
}

export interface BrandfetchNormalized {
  logos: string[];
  icons: string[];
  colors: BrandfetchNormalizedColor[];
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
}

export type BrandfetchToolResult =
  | {
      kind: "brandfetch_result";
      domain: string;
      raw: unknown;
      normalized: BrandfetchNormalized;
    }
  | {
      kind: "brandfetch_error";
      domain?: string | null;
      status?: number;
      body?: unknown;
      error?: string;
    };

export async function brandfetch_fetch_impl({
  url,
}: {
  url: string;
}): Promise<BrandfetchToolResult> {
  const domain = extractDomain(url);

  if (!domain) {
    return {
      kind: "brandfetch_error",
      domain,
      error: "Unable to determine domain from URL.",
    };
  }

  const endpoint = `https://api.brandfetch.io/v2/brands/${domain}`;
  const authToken = process.env.BRANDFETCH_API_KEY;

  if (!authToken) {
    return {
      kind: "brandfetch_error",
      domain,
      error: "Missing Brandfetch credentials.",
    };
  }

  const headers = {
    Authorization: `Bearer ${authToken}`,
    Accept: "application/json",
  };

  try {
    const { fetchPromise } = withTimeout(endpoint, { headers });
    const response = await fetchPromise;

    if (!response.ok) {
      const text = await safeReadBody(response);
      return {
        kind: "brandfetch_error",
        domain,
        status: response.status,
        body: text,
      };
    }

    const json = await response.json();
    const normalized = normalizeBrandfetchPayload(json);

    return {
      kind: "brandfetch_result",
      domain,
      raw: json,
      normalized,
    };
  } catch (error) {
    console.warn("brandfetch_fetch_impl error", {
      message: error instanceof Error ? error.message : String(error),
    });

    return {
      kind: "brandfetch_error",
      domain,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function safeReadBody(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch (error) {
    console.warn("Failed to read Brandfetch error body", {
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

type BrandfetchColor = {
  hex?: string;
  type?: string;
};

type BrandfetchLogoFormat = {
  src?: string;
};

type BrandfetchLogo = {
  type?: string;
  formats?: BrandfetchLogoFormat[];
};

function normalizeBrandfetchPayload(payload: any): BrandfetchNormalized {
  const logos: string[] = [];
  const icons: string[] = [];

  const logoEntries: BrandfetchLogo[] = Array.isArray(payload?.logos)
    ? payload.logos
    : [];

  for (const entry of logoEntries) {
    const formatSources = Array.isArray(entry?.formats)
      ? entry.formats
          .map((format) => format?.src)
          .filter((src): src is string => Boolean(src))
      : [];

    if (entry?.type === "icon") {
      icons.push(...formatSources);
    } else {
      logos.push(...formatSources);
    }
  }

  const colors: BrandfetchNormalizedColor[] = [];
  const colorEntries: BrandfetchColor[] = Array.isArray(payload?.colors)
    ? payload.colors
    : [];

  for (const color of colorEntries) {
    if (!color?.hex) {
      continue;
    }

    const normalizedHex = normalizeColor(color.hex);
    if (!normalizedHex) {
      continue;
    }

    const role = mapBrandfetchColorType(color.type);
    colors.push({ hex: normalizedHex, role, source: "brandfetch" });
  }

  const dedupedColors = dedupeColors(colors);

  const lookup = (role: string) =>
    dedupedColors.find((color) => color.role === role)?.hex ?? "";

  return {
    logos: Array.from(new Set(logos)),
    icons: Array.from(new Set(icons)),
    colors: dedupedColors,
    primaryColor: lookup("primary") || undefined,
    secondaryColor: lookup("secondary") || undefined,
    accentColor: lookup("accent") || undefined,
    backgroundColor: lookup("background") || undefined,
    textColor: lookup("text") || undefined,
  };
}

function mapBrandfetchColorType(type: string | undefined): string | undefined {
  if (!type) {
    return "unknown";
  }

  const normalized = type.toLowerCase();
  switch (normalized) {
    case "accent":
      return "accent";
    case "dark":
    case "brand":
    case "primary":
      return "primary";
    case "light":
    case "background":
      return "background";
    case "text":
      return "text";
    case "secondary":
      return "secondary";
    default:
      return "unknown";
  }
}

export type CuaBrowseToolResult =
  | {
      kind: "cua_browse_result";
      url: string;
      screenshotPngBase64?: string;
      icons: string[];
      logos: string[];
      colors: ColorEntry[];
    }
  | {
      kind: "cua_browse_error";
      url: string;
      error: string;
    };

export async function cua_browse_impl({
  url,
  goal: _goal,
}: {
  url: string;
  goal?: string;
  max_steps?: number;
}): Promise<CuaBrowseToolResult> {
  try {
    const { fetchPromise } = withTimeout(url, {
      headers: { "User-Agent": "BrandScanner/1.0" },
    });
    const response = await fetchPromise;
    const html = await response.text();

    const $ = cheerio.load(html);
    const icons = extractIcons($, url);
    const logos = extractLogos($, url);
    const colors = extractColors($, html);

    return {
      kind: "cua_browse_result",
      url,
      icons: Array.from(new Set(icons)),
      logos: Array.from(new Set(logos)),
      colors: dedupeColors(colors),
    };
  } catch (error) {
    console.warn("cua_browse_impl error", {
      message: error instanceof Error ? error.message : String(error),
    });

    return {
      kind: "cua_browse_error",
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractIcons($: cheerio.CheerioAPI, baseUrl: string): string[] {
  const hrefs = new Set<string>();
  $(`link[rel*="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]`).each(
    (_index, element) => {
      const href = $(element).attr("href");
      if (!href) {
        return;
      }
      const resolved = resolveUrl(baseUrl, href);
      if (resolved) {
        hrefs.add(resolved);
      }
    }
  );
  return Array.from(hrefs);
}

function extractLogos($: cheerio.CheerioAPI, baseUrl: string): string[] {
  const srcs = new Set<string>();
  $("img").each((_index, element) => {
    const src = $(element).attr("src");
    if (!src) {
      return;
    }

    const alt = ($(element).attr("alt") ?? "").toLowerCase();
    const className = ($(element).attr("class") ?? "").toLowerCase();
    if (alt.includes("logo") || alt.includes("brand") || className.includes("logo")) {
      const resolved = resolveUrl(baseUrl, src);
      if (resolved) {
        srcs.add(resolved);
      }
    }
  });
  return Array.from(srcs);
}

function extractColors($: cheerio.CheerioAPI, html: string): ColorEntry[] {
  const colors: ColorEntry[] = [];

  const themeColor = $('meta[name="theme-color"]').attr("content");
  if (themeColor) {
    const normalized = normalizeColor(themeColor);
    if (normalized) {
      colors.push({ hex: normalized, role: "accent", source: "meta" });
    }
  }

  const bodyStyle = $("body").attr("style") ?? "";
  const backgroundMatch = bodyStyle.match(/background(?:-color)?:\s*([^;]+)/i);
  if (backgroundMatch) {
    const normalized = normalizeColor(backgroundMatch[1]);
    if (normalized) {
      colors.push({ hex: normalized, role: "background", source: "inline" });
    }
  }

  const textMatch = bodyStyle.match(/color:\s*([^;]+)/i);
  if (textMatch) {
    const normalized = normalizeColor(textMatch[1]);
    if (normalized) {
      colors.push({ hex: normalized, role: "text", source: "inline" });
    }
  }

  const variableRegex = /--(primary|secondary|accent|background|text)[^:]*:\s*([^;]+);/gi;
  let match: RegExpExecArray | null;
  while ((match = variableRegex.exec(html)) !== null) {
    const variableRole = match[1].toLowerCase();
    const value = match[2];
    const normalized = normalizeColor(value);
    if (normalized) {
      colors.push({ hex: normalized, role: variableRole, source: "css-var" });
    }
  }

  const hexRegex = /#[0-9a-fA-F]{6}\b/g;
  const seen = new Set<string>();
  let hexMatch: RegExpExecArray | null;
  while ((hexMatch = hexRegex.exec(html)) !== null) {
    const normalized = normalizeColor(hexMatch[0]);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      colors.push({ hex: normalized, role: "unknown", source: "html" });
    }
  }

  return colors;
}

function resolveUrl(baseUrl: string, maybeRelative: string): string | null {
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch (error) {
    return null;
  }
}
