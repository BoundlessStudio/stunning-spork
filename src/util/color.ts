export interface ColorEntry {
  hex: string;
  role?: string;
  source?: string;
}

const HEX_REGEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_REGEX = /^rgba?\(([^)]+)\)$/i;

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function normalizeColor(input: string): string | null {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();

  if (HEX_REGEX.test(trimmed)) {
    const hex = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
    if (hex.length === 3) {
      const expanded = hex
        .split("")
        .map((char) => char + char)
        .join("");
      return `#${expanded.toLowerCase()}`;
    }

    if (hex.length === 6) {
      return `#${hex.toLowerCase()}`;
    }

    if (hex.length === 8) {
      return `#${hex.slice(0, 6).toLowerCase()}`;
    }
  }

  const rgbMatch = trimmed.match(RGB_REGEX);
  if (rgbMatch) {
    const parts = rgbMatch[1]
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    if (parts.length >= 3) {
      const rgbValues = parts.slice(0, 3).map((value) => {
        if (value.endsWith("%")) {
          const numeric = Number.parseFloat(value.slice(0, -1));
          if (Number.isNaN(numeric)) {
            return null;
          }
          return clampByte((numeric / 100) * 255);
        }

        const numeric = Number.parseFloat(value);
        if (Number.isNaN(numeric)) {
          return null;
        }
        return clampByte(numeric);
      });

      if (rgbValues.every((value): value is number => value !== null)) {
        const hex = rgbValues
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("");
        return `#${hex}`;
      }
    }
  }

  return null;
}

export function dedupeColors<T extends ColorEntry>(colors: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const color of colors) {
    const normalizedHex = normalizeColor(color.hex);
    if (!normalizedHex) {
      continue;
    }

    const key = `${normalizedHex}|${color.role ?? ""}|${color.source ?? ""}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({ ...color, hex: normalizedHex });
  }

  return result;
}
