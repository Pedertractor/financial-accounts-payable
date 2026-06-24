import {
  createReconciliationRun,
  getLatestReconciliationRun,
  getReconciliationRun,
  requestInitWithTimeout,
} from '@/lib/api';
import {
  clearStoredReconciliationRunId,
  getStoredReconciliationRunId,
  setStoredReconciliationRunId,
  type ConciliationUnit,
} from '@/lib/reconcile-storage';

/** Tempo em que o run da sessão é considerado fresco (menos refetch ao voltar à aba). */
export const VINCULOS_RUN_QUERY_STALE_MS = 5 * 60 * 1000;

/** Mantém o run em memória ao navegar entre telas (evita “Carregando…” ao voltar da Importação). */
export const VINCULOS_RUN_QUERY_GC_MS = 30 * 60 * 1000;

export function vinculosReconciliationRunQueryKey(unit: ConciliationUnit) {
  return ['reconciliation-run', 'vinculos', unit] as const;
}

export function importReconciliationRunQueryKey(unit: ConciliationUnit) {
  return ['reconciliation-run', 'import-page', unit] as const;
}

/**
 * Resolve o run da triagem: valida o id em localStorage (inclui encerrado, para consulta).
 */
export async function fetchVinculosReconciliationRunId(
  unit: ConciliationUnit,
  signal?: AbortSignal,
): Promise<string | null> {
  const rInit = requestInitWithTimeout(signal, 45_000);
  const existing = getStoredReconciliationRunId();
  if (existing) {
    try {
      const { run } = await getReconciliationRun(existing, rInit);
      if (run.unit === unit) {
        return existing;
      }
    } catch {
      /* 404 / inválido */
    }
    clearStoredReconciliationRunId();
  }
  const { run: latest } = await getLatestReconciliationRun({ unit }, rInit);
  if (latest) {
    setStoredReconciliationRunId(latest.id);
    return latest.id;
  }
  return null;
}

/**
 * Run aberto para importação: ignora id encerrado no storage; cria novo se necessário.
 */
export async function resolveImportReconciliationRunId(
  unit: ConciliationUnit,
  signal?: AbortSignal,
): Promise<string> {
  const rInit = requestInitWithTimeout(signal, 45_000);
  const existing = getStoredReconciliationRunId();
  if (existing) {
    try {
      const { run } = await getReconciliationRun(existing, rInit);
      if (run.unit === unit && run.status !== 'CLOSED') {
        return existing;
      }
      if (run.status === 'CLOSED') {
        clearStoredReconciliationRunId();
      }
    } catch {
      clearStoredReconciliationRunId();
    }
  }
  const { run: latest } = await getLatestReconciliationRun({ unit }, rInit);
  if (latest) {
    setStoredReconciliationRunId(latest.id);
    return latest.id;
  }
  const { run } = await createReconciliationRun({
    title: 'Importação',
    unit,
  });
  setStoredReconciliationRunId(run.id);
  return run.id;
}
