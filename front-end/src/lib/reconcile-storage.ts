/** Estado de cliente da conciliação: localStorage (sobrevive a reload e abas) com migração de sessionStorage. */

const RUN_ID_KEY = 'reconcile_run_id'
const CONCILIACAO_UNIT_KEY = 'reconcile_conciliacao_unit'

export type ConciliationUnit = 'PEDERTRACTOR' | 'TRACTOR'

const VINCULOS_COMPARE_DATE_KEY = 'reconcile_vinculos_compare_date'
const VINCULOS_FILTER_BY_DAY_KEY = 'reconcile_vinculos_filter_by_day'

function todayIsoDate(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function getStoredReconciliationRunId(): string | null {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    let v = localStorage.getItem(RUN_ID_KEY)
    if (v) {
      return v
    }
    v = sessionStorage.getItem(RUN_ID_KEY)
    if (v) {
      localStorage.setItem(RUN_ID_KEY, v)
      sessionStorage.removeItem(RUN_ID_KEY)
    }
    return v
  } catch {
    return null
  }
}

export function setStoredReconciliationRunId(id: string) {
  if (typeof window === 'undefined') {
    return
  }
  try {
    localStorage.setItem(RUN_ID_KEY, id)
    sessionStorage.removeItem(RUN_ID_KEY)
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearStoredReconciliationRunId() {
  if (typeof window === 'undefined') {
    return
  }
  try {
    localStorage.removeItem(RUN_ID_KEY)
    sessionStorage.removeItem(RUN_ID_KEY)
  } catch {
    /* ignore */
  }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

export function getStoredVinculosCompareDate(): string {
  if (typeof window === 'undefined') {
    return todayIsoDate()
  }
  try {
    const s = localStorage.getItem(VINCULOS_COMPARE_DATE_KEY)
    if (s && YMD.test(s)) {
      return s
    }
  } catch {
    /* ignore */
  }
  return todayIsoDate()
}

export function setStoredVinculosCompareDate(ymd: string) {
  if (typeof window === 'undefined' || !YMD.test(ymd)) {
    return
  }
  try {
    localStorage.setItem(VINCULOS_COMPARE_DATE_KEY, ymd)
  } catch {
    /* ignore */
  }
}

export function getStoredVinculosFilterByDay(): boolean {
  if (typeof window === 'undefined') {
    return true
  }
  try {
    const s = localStorage.getItem(VINCULOS_FILTER_BY_DAY_KEY)
    if (s === '0' || s === 'false') {
      return false
    }
  } catch {
    /* ignore */
  }
  return true
}

export function setStoredVinculosFilterByDay(v: boolean) {
  if (typeof window === 'undefined') {
    return
  }
  try {
    localStorage.setItem(VINCULOS_FILTER_BY_DAY_KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/** Logout: limpar run e filtros da tela de vínculos. */
export function clearReconcileClientState() {
  clearStoredReconciliationRunId()
  if (typeof window === 'undefined') {
    return
  }
  try {
    localStorage.removeItem(VINCULOS_COMPARE_DATE_KEY)
    localStorage.removeItem(VINCULOS_FILTER_BY_DAY_KEY)
    localStorage.removeItem(CONCILIACAO_UNIT_KEY)
  } catch {
    /* ignore */
  }
}

function isConciliationUnit(v: string | null): v is ConciliationUnit {
  return v === 'TRACTOR' || v === 'PEDERTRACTOR'
}

/** Tela de conciliação: padrão PEDERTRACTOR se nunca salvou. */
export function getStoredConciliationUnitForVinculos(): ConciliationUnit {
  if (typeof window === 'undefined') {
    return 'PEDERTRACTOR'
  }
  try {
    const s = localStorage.getItem(CONCILIACAO_UNIT_KEY)
    if (isConciliationUnit(s)) {
      return s
    }
  } catch {
    /* ignore */
  }
  return 'PEDERTRACTOR'
}

/**
 * Import: só reaproveita empresa se o usuário já tiver escolhido antes; primeira visita null.
 */
export function getStoredConciliationUnitForImport(): ConciliationUnit | null {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const s = localStorage.getItem(CONCILIACAO_UNIT_KEY)
    if (isConciliationUnit(s)) {
      return s
    }
  } catch {
    /* ignore */
  }
  return null
}

export function setStoredConciliationUnit(unit: ConciliationUnit) {
  if (typeof window === 'undefined') {
    return
  }
  try {
    localStorage.setItem(CONCILIACAO_UNIT_KEY, unit)
  } catch {
    /* ignore */
  }
}
