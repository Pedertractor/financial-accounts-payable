const SUFFIX_RE =
  /\b(LTDA|LTDA\.|S\.?A\.?|ME|EPP|COML?|COMERCIO|COMÉRCIO|EIRELI|SS|CIA)\b/gi;

/**
 * Normalização básica para heurística de match (MVP).
 */
export function normalizeCounterpartyName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(SUFFIX_RE, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
