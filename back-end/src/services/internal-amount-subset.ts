/**
 * Teto de passos da DFS: evita travar o event loop em n alto com podas fracas
 * (ex.: muitas parcelas pequenas e alvo muito redondo).
 */
const MAX_SUBSET_DFS_STEPS = 12_000_000;

/**
 * Encontra subconjuntos de tamanho mín. `minSize` cuja soma (em centavos) = alvo.
 * DFS com poda; ordem determinística (ids ordenados).
 */
export function findAmountSubsetsEqualing(
  items: { id: string; cents: number }[],
  targetCents: number,
  minSize: number,
  maxResults: number,
): string[][] {
  if (minSize < 1 || maxResults < 1 || targetCents < 0) {
    return [];
  }
  const use = items
    .filter((i) => i.cents > 0 && i.cents <= targetCents)
    .sort((a, b) => a.id.localeCompare(b.id));
  const n = use.length;
  if (n < minSize) {
    return [];
  }
  const rem: number[] = new Array(n + 1);
  rem[n] = 0;
  for (let j = n - 1; j >= 0; j -= 1) {
    rem[j] = rem[j + 1]! + use[j]!.cents;
  }
  const out: string[][] = [];
  const path: string[] = [];
  let steps = 0;
  const dfs = (i: number, cur: number): void => {
    if (steps++ > MAX_SUBSET_DFS_STEPS) {
      return;
    }
    if (out.length >= maxResults) {
      return;
    }
    if (cur === targetCents && path.length >= minSize) {
      out.push([...path]);
      return;
    }
    if (i >= n) {
      return;
    }
    if (cur + rem[i]! < targetCents) {
      return;
    }
    if (cur > targetCents) {
      return;
    }
    dfs(i + 1, cur);
    if (cur + use[i]!.cents <= targetCents) {
      path.push(use[i]!.id);
      dfs(i + 1, cur + use[i]!.cents);
      path.pop();
    }
  };
  dfs(0, 0);
  out.sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()));
  return out;
}
