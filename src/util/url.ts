import { parse } from "tldts";

export function extractDomain(url: string): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = parse(url, { allowPrivateDomains: true });
    if (!parsed.domain || parsed.domain === "") {
      return null;
    }

    return parsed.domain;
  } catch (error) {
    return null;
  }
}
