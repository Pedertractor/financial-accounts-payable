/** Estado de cliente da conciliação: localStorage (sobrevive a reload e abas) com migração de sessionStorage. */

const RUN_ID_KEY = 'reconcile_run_id'
const CONCILIACAO_UNIT_KEY = 'reconcile_conciliacao_unit'

export type ConciliationUnit = 'PEDERTRACTOR' | 'TRACTOR'

const VINCULOS_COMPARE_DATE_KEY = 'reconcile_vinculos_compare_date'
const VINCULOS_COMPARE_RANGE_KEY = 'reconcile_vinculos_compare_range'
export type VinculosDateRangeYmd = { from: string; to: string }

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

function parseVinculosRange(s: string | null): VinculosDateRangeYmd | null {
  if (s == null) {
    return null
  }
  try {
    const o = JSON.parse(s) as { from?: unknown; to?: unknown }
    if (
      typeof o.from === 'string' &&
      typeof o.to === 'string' &&
      YMD.test(o.from) &&
      YMD.test(o.to) &&
      o.from <= o.to
    ) {
      return { from: o.from, to: o.to }
    }
  } catch {
    /* ignore */
  }
  return null
}

export function getStoredVinculosDateRange(): VinculosDateRangeYmd {
  if (typeof window === 'undefined') {
    const t = todayIsoDate()
    return { from: t, to: t }
  }
  try {
    const r = parseVinculosRange(localStorage.getItem(VINCULOS_COMPARE_RANGE_KEY))
    if (r) {
      // Filtro de vínculos: uma única data; legado com intervalo usa só o dia inicial.
      const d = r.from
      if (r.to !== d) {
        return { from: d, to: d }
      }
      return r
    }
    const s = localStorage.getItem(VINCULOS_COMPARE_DATE_KEY)
    if (s && YMD.test(s)) {
      return { from: s, to: s }
    }
  } catch {
    /* ignore */
  }
  const t = todayIsoDate()
  return { from: t, to: t }
}

export function setStoredVinculosDateRange(range: VinculosDateRangeYmd) {
  if (
    typeof window === 'undefined' ||
    !YMD.test(range.from) ||
    !YMD.test(range.to) ||
    range.from > range.to
  ) {
    return
  }
  try {
    localStorage.setItem(VINCULOS_COMPARE_RANGE_KEY, JSON.stringify(range))
  } catch {
    /* ignore */
  }
}

/** @deprecated use getStoredVinculosDateRange / setStoredVinculosDateRange */
export function getStoredVinculosCompareDate(): string {
  return getStoredVinculosDateRange().from
}

/** @deprecated use setStoredVinculosDateRange */
export function setStoredVinculosCompareDate(ymd: string) {
  if (!YMD.test(ymd)) {
    return
  }
  setStoredVinculosDateRange({ from: ymd, to: ymd })
}

/** Logout: limpar run e filtros da tela de vínculos. */
export function clearReconcileClientState() {
  clearStoredReconciliationRunId()
  if (typeof window === 'undefined') {
    return
  }
  try {
    localStorage.removeItem(VINCULOS_COMPARE_DATE_KEY)
    localStorage.removeItem(VINCULOS_COMPARE_RANGE_KEY)
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
