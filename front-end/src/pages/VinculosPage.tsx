import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Banknote,
  Database,
  Landmark,
  QrCode,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AccountPaidConfirmDialog } from '@/components/account-paid-confirm-dialog'
import { PaymentInstructionModal } from '@/components/payment-instruction-modal'
import { SuggestionDetailModal } from '@/components/suggestion-detail-modal'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  confirmSuggestionsBatch,
  getLatestReconciliationRun,
  getReconciliationRun,
  listRunSuggestions,
  markSuggestionPaid,
  type SuggestionListItem,
} from '@/lib/api'
import {
  getStoredReconciliationRunId,
  setStoredReconciliationRunId,
  clearStoredReconciliationRunId,
  getStoredVinculosCompareDate,
  getStoredVinculosFilterByDay,
  setStoredVinculosCompareDate,
  setStoredVinculosFilterByDay,
  getStoredConciliationUnitForVinculos,
  setStoredConciliationUnit,
  type ConciliationUnit,
} from '@/lib/reconcile-storage'
import { cn } from '@/lib/utils'

function formatBrlAmount(raw: string | null): string {
  if (raw == null || raw === '') {
    return '—'
  }
  const n = Number.parseFloat(raw)
  if (Number.isNaN(n)) {
    return raw
  }
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function formatDatePt(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    }
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

function formatDateTimePtBr(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

const REASON_META: Record<
  string,
  { label: string; className: string }
> = {
  EXACT_NAME_VALUE: {
    label: 'NOME E VALOR EXATOS',
    className: 'text-emerald-700 dark:text-emerald-400',
  },
  FUZZY_NAME_MATCH: {
    label: 'NOME APROXIMADO',
    className: 'text-sky-700 dark:text-sky-400',
  },
  VALUE_ONLY: {
    label: 'SÓ VALOR',
    className: 'text-emerald-600 dark:text-emerald-400',
  },
  MULTIPLE_CANDIDATES: {
    label: 'VÁRIOS CANDIDATOS',
    className: 'text-amber-700 dark:text-amber-400',
  },
  AGGREGATED_CANDIDATE: {
    label: 'AGREGADO',
    className: 'text-violet-700 dark:text-violet-400',
  },
  NO_INTERNAL_MATCH: {
    label: 'SEM PAR INTERNO',
    className: 'text-red-600 dark:text-red-400',
  },
  NO_BANK_MATCH: {
    label: 'SEM PAR BANCO',
    className: 'text-red-600 dark:text-red-400',
  },
  PIX_CANDIDATE: {
    label: 'PIX (SUGESTÃO)',
    className: 'text-teal-600 dark:text-teal-400',
  },
  PIX_VINCULO_OK: {
    label: 'PIX',
    className: 'text-emerald-600 dark:text-emerald-400',
  },
  TED_CANDIDATE: {
    label: 'TED (SUGESTÃO)',
    className: 'text-cyan-600 dark:text-cyan-400',
  },
  TED_VINCULO_OK: {
    label: 'TED',
    className: 'text-sky-600 dark:text-sky-400',
  },
  MANUAL_REVIEW_REQUIRED: {
    label: 'REVISÃO MANUAL',
    className: 'text-amber-700 dark:text-amber-400',
  },
}

function ReasonCell({ reason }: { reason: string }) {
  const meta = REASON_META[reason] ?? {
    label: reason,
    className: 'text-muted-foreground',
  }
  return (
    <span
      className={cn(
        'font-mono text-xs font-medium tracking-tight',
        meta.className,
      )}
    >
      {meta.label}
    </span>
  )
}

function getReasonCategory(r: SuggestionListItem): 'revisao' | 'padrao' {
  if (r.reasonCategory === 'revisao' || r.reasonCategory === 'padrao') {
    return r.reasonCategory
  }
  return [
    'FUZZY_NAME_MATCH',
    'MANUAL_REVIEW_REQUIRED',
    'VALUE_ONLY',
  ].includes(r.reason)
    ? 'revisao'
    : 'padrao'
}

function MotivoDiffCell({ row }: { row: SuggestionListItem }) {
  const categoria = getReasonCategory(row)
  const detalheEnum =
    REASON_META[row.reason]?.label ?? row.reason
  if (categoria === 'revisao') {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          className="text-amber-800 dark:text-amber-200 font-mono text-xs font-semibold tracking-tight"
          title={detalheEnum}
        >
          Revisão
        </span>
        {row.amountDifference && row.amountDifference !== '0' && (
          <span className="text-muted-foreground text-[0.7rem]">
            Δ {formatBrlAmount(row.amountDifference)}
          </span>
        )}
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <ReasonCell reason={row.reason} />
      {row.amountDifference && row.amountDifference !== '0' && (
        <span className="text-muted-foreground text-[0.7rem]">
          Δ {formatBrlAmount(row.amountDifference)}
        </span>
      )}
    </div>
  )
}

type SortColumn = 'index' | 'amount'
type SortDir = 'asc' | 'desc'

function parseAmount(n: string | null | undefined): number {
  if (n == null || n === '') {
    return Number.NaN
  }
  return Number.parseFloat(n)
}

/** Ordenar por valor: prioriza banco, depois interno, depois legado `amount`. */
function amountForSort(r: SuggestionListItem): number {
  const bank = parseAmount(r.amountBank)
  if (!Number.isNaN(bank)) {
    return bank
  }
  const inter = parseAmount(r.amountInternal)
  if (!Number.isNaN(inter)) {
    return inter
  }
  return parseAmount(r.amount)
}

function bancoBarraInternoText(r: SuggestionListItem): string {
  const b = formatBrlAmount(r.amountBank ?? null)
  const i = formatBrlAmount(r.amountInternal ?? null)
  if (b === '—' && i === '—') {
    return formatBrlAmount(r.amount)
  }
  return `${b} / ${i}`
}

function getSuggestionStatus(r: SuggestionListItem): string {
  if (r.suggestionStatus) {
    return r.suggestionStatus
  }
  if (r.status) {
    return r.status
  }
  return 'OPEN'
}

function isPendente(r: SuggestionListItem): boolean {
  return getSuggestionStatus(r) === 'OPEN'
}

function canShowConfirmA(r: SuggestionListItem): boolean {
  if (!isPendente(r)) {
    return false
  }
  if (r.canConfirm === true) {
    return true
  }
  if (r.canConfirm === false) {
    return false
  }
  return (
    r.reason === 'EXACT_NAME_VALUE' ||
    r.reason === 'PIX_CANDIDATE' ||
    r.reason === 'TED_CANDIDATE' ||
    getReasonCategory(r) === 'revisao'
  )
}

function getApprovedPaymentVinculoKind(
  r: SuggestionListItem,
): 'PIX' | 'TED' | null {
  if (r.paymentVinculoKind === 'PIX' || r.paymentVinculoKind === 'TED') {
    return r.paymentVinculoKind
  }
  if (r.reason === 'PIX_VINCULO_OK') {
    return 'PIX'
  }
  if (r.reason === 'TED_VINCULO_OK') {
    return 'TED'
  }
  return null
}

function isSuggestionMarkedPaid(r: SuggestionListItem): boolean {
  return r.paidAt != null && r.paidAt !== ''
}

function StatusCell({ row }: { row: SuggestionListItem }) {
  const st = getSuggestionStatus(row)
  if (st === 'APPROVED' && isSuggestionMarkedPaid(row)) {
    return (
      <Badge
        variant="secondary"
        className="border-violet-200 bg-violet-50 font-mono text-xs text-violet-900 dark:border-violet-900/50 dark:bg-violet-950/50 dark:text-violet-200"
      >
        Pago
      </Badge>
    )
  }
  if (st === 'APPROVED') {
    return (
      <Badge
        variant="secondary"
        className="border-emerald-200 bg-emerald-50 font-mono text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-200"
      >
        Conferido
      </Badge>
    )
  }
  if (st === 'OPEN') {
    return (
      <Badge
        variant="secondary"
        className="font-mono text-xs border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-200"
      >
        Pendente
      </Badge>
    )
  }
  return (
    <span className="text-muted-foreground font-mono text-[0.7rem]">{st}</span>
  )
}

const suggestionsQk = (
  unit: ConciliationUnit,
  rid: string | null | undefined,
  byDay: boolean,
  d: string,
  statusFilter: 'todos' | 'pendente' | 'conferido' | 'pago',
) =>
  [
    'reconciliation-suggestions',
    unit,
    rid ?? null,
    byDay,
    d,
    statusFilter,
  ] as const

/** Não dispara atalho A em campos de edição; checkboxes/radio não bloqueiam (foco fica neles após marcar). */
function shouldBlockConfirmHotkey(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.closest('textarea, select, [contenteditable]')) {
    return true
  }
  const input = target.closest('input')
  if (!input) {
    return false
  }
  const type = (input as HTMLInputElement).type
  if (type === 'checkbox' || type === 'radio') {
    return false
  }
  return true
}

export function VinculosPage() {
  const queryClient = useQueryClient()
  const [unitFilter, setUnitFilter] = useState<ConciliationUnit>(
    getStoredConciliationUnitForVinculos,
  )
  const [compareDate, setCompareDate] = useState<string>(getStoredVinculosCompareDate)
  /** Se falso, lista todas as sugestões do run (sem recorte por data de vencimento). */
  const [filterByDay, setFilterByDay] = useState(getStoredVinculosFilterByDay)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [tableSort, setTableSort] = useState<{
    column: SortColumn
    dir: SortDir
  } | null>(null)
  const [statusFilter, setStatusFilter] = useState<
    'todos' | 'pendente' | 'conferido' | 'pago'
  >('todos')
  const [suggestionDetail, setSuggestionDetail] = useState<{
    row: SuggestionListItem
    line: number
  } | null>(null)
  const [paymentInstructionId, setPaymentInstructionId] = useState<
    string | null
  >(null)
  const [markPaidForRow, setMarkPaidForRow] =
    useState<SuggestionListItem | null>(null)
  const [paidInfoRow, setPaidInfoRow] = useState<SuggestionListItem | null>(
    null,
  )

  useEffect(() => {
    setStoredVinculosCompareDate(compareDate)
  }, [compareDate])

  useEffect(() => {
    setStoredVinculosFilterByDay(filterByDay)
  }, [filterByDay])

  useEffect(() => {
    setStoredConciliationUnit(unitFilter)
  }, [unitFilter])

  const { data: runId, isLoading: runLoading } = useQuery({
    queryKey: ['reconciliation-run', 'vinculos', unitFilter],
    queryFn: async () => {
      const existing = getStoredReconciliationRunId()
      if (existing) {
        try {
          const { run } = await getReconciliationRun(existing)
          if (run.unit === unitFilter) {
            return existing
          }
        } catch {
          /* 404 / inválido */
        }
        clearStoredReconciliationRunId()
      }
      const { run: latest } = await getLatestReconciliationRun({ unit: unitFilter })
      if (latest) {
        setStoredReconciliationRunId(latest.id)
        return latest.id
      }
      return null
    },
    staleTime: 0,
    refetchOnMount: 'always',
  })

  const { data, isLoading, isError, error } = useQuery({
    queryKey: suggestionsQk(unitFilter, runId, filterByDay, compareDate, statusFilter),
    queryFn: () =>
      listRunSuggestions(runId!, {
        ...(filterByDay ? { date: compareDate } : {}),
        limit: 2000,
        statusFilter,
      }),
    enabled: runId != null,
  })

  const confirmBatchMutation = useMutation({
    mutationFn: (ids: string[]) => confirmSuggestionsBatch(runId!, ids),
    onSuccess: () => {
      setSelectedIds(new Set())
      if (runId) {
        void queryClient.invalidateQueries({
          queryKey: ['reconciliation-suggestions', unitFilter, runId],
        })
      }
    },
  })

  const markPaidMutation = useMutation({
    mutationFn: (suggestionId: string) => markSuggestionPaid(runId!, suggestionId),
    onSuccess: () => {
      setMarkPaidForRow(null)
      if (runId) {
        void queryClient.invalidateQueries({
          queryKey: ['reconciliation-suggestions', unitFilter, runId],
        })
      }
    },
  })

  const rows: SuggestionListItem[] = data?.items ?? []
  const summary = useMemo(() => {
    if (runId == null) {
      return { total: 0, pendente: 0, conferido: 0, pago: 0 }
    }
    return data?.summary ?? { total: 0, pendente: 0, conferido: 0, pago: 0 }
  }, [runId, data?.summary])
  const rowById = useMemo(
    () => new Map(rows.map((r) => [r.id, r] as const)),
    [rows],
  )

  /** Cada item inclui `line` = posição 1..n na ordem original da API (referência fixa), mesmo após reordenar a tabela. */
  const displayRows = useMemo(() => {
    if (rows.length === 0) {
      return [] as { row: SuggestionListItem; line: number }[]
    }
    const withOrig = rows.map((r, orig) => ({ r, orig, line: orig + 1 }))
    if (tableSort == null) {
      return withOrig.map((x) => ({ row: x.r, line: x.line }))
    }
    if (tableSort.column === 'index') {
      withOrig.sort((a, b) =>
        tableSort.dir === 'asc' ? a.orig - b.orig : b.orig - a.orig,
      )
    } else {
      withOrig.sort((a, b) => {
        const na = amountForSort(a.r)
        const nb = amountForSort(b.r)
        if (Number.isNaN(na) && Number.isNaN(nb)) {
          return 0
        }
        if (Number.isNaN(na)) {
          return 1
        }
        if (Number.isNaN(nb)) {
          return -1
        }
        return tableSort.dir === 'asc' ? na - nb : nb - na
      })
    }
    return withOrig.map((x) => ({ row: x.r, line: x.line }))
  }, [rows, tableSort])

  const selectedConfirmableIds = useMemo(() => {
    return [...selectedIds].filter((id) => {
      const r = rowById.get(id)
      return r != null && canShowConfirmA(r)
    })
  }, [selectedIds, rowById])

  const headerSelectRef = useRef<HTMLInputElement>(null)
  const allOnPageSelected = useMemo(
    () =>
      displayRows.length > 0 &&
      displayRows.every((item) => selectedIds.has(item.row.id)),
    [displayRows, selectedIds],
  )
  const someOnPageSelected = useMemo(
    () => displayRows.some((item) => selectedIds.has(item.row.id)),
    [displayRows, selectedIds],
  )

  useEffect(() => {
    const el = headerSelectRef.current
    if (el) {
      el.indeterminate = someOnPageSelected && !allOnPageSelected
    }
  }, [someOnPageSelected, allOnPageSelected])

  function toggleSelectedId(id: string) {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) {
        n.delete(id)
      } else {
        n.add(id)
      }
      return n
    })
  }

  function toggleSelectAllOnPage() {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      const pageIds = displayRows.map((i) => i.row.id)
      const all =
        pageIds.length > 0 && pageIds.every((pId) => n.has(pId))
      if (all) {
        for (const pId of pageIds) {
          n.delete(pId)
        }
      } else {
        for (const pId of pageIds) {
          n.add(pId)
        }
      }
      return n
    })
  }

  const runTitle =
    runId == null
      ? '—'
      : (data?.run.title?.trim() || 'Conciliação')

  const highConfidencePct = useMemo(() => {
    if (rows.length === 0) {
      return 0
    }
    const good = rows.filter((r) => r.scorePercent >= 80).length
    return Math.round((100 * good) / rows.length)
  }, [rows])

  /** Soma dos valores banco e ERP nas linhas atualmente exibidas (filtro/ordenação). */
  const displayAmountTotals = useMemo(() => {
    let bankSum = 0
    let bankN = 0
    let internalSum = 0
    let internalN = 0
    for (const { row } of displayRows) {
      const b = parseAmount(row.amountBank)
      if (!Number.isNaN(b)) {
        bankSum += b
        bankN += 1
      }
      const i = parseAmount(row.amountInternal)
      if (!Number.isNaN(i)) {
        internalSum += i
        internalN += 1
      }
    }
    return {
      bankText: bankN > 0 ? formatBrlAmount(String(bankSum)) : '—',
      internalText: internalN > 0 ? formatBrlAmount(String(internalSum)) : '—',
    }
  }, [displayRows])

  function cycleSortIndex() {
    setTableSort((prev) => {
      if (prev?.column !== 'index') {
        return { column: 'index', dir: 'asc' }
      }
      if (prev.dir === 'asc') {
        return { column: 'index', dir: 'desc' }
      }
      return null
    })
  }

  function cycleSortAmount() {
    setTableSort((prev) => {
      if (prev?.column !== 'amount') {
        return { column: 'amount', dir: 'desc' }
      }
      if (prev.dir === 'desc') {
        return { column: 'amount', dir: 'asc' }
      }
      return null
    })
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'a' && e.key !== 'A') {
        return
      }
      if (shouldBlockConfirmHotkey(e.target)) {
        return
      }
      if (
        confirmBatchMutation.isPending ||
        selectedConfirmableIds.length === 0 ||
        !runId
      ) {
        return
      }
      e.preventDefault()
      confirmBatchMutation.mutate(selectedConfirmableIds)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [confirmBatchMutation, runId, selectedConfirmableIds])

  if (runLoading) {
    return (
      <div className="text-muted-foreground p-4 text-sm">Carregando…</div>
    )
  }

  return (
    <div className="bg-muted/20 flex min-h-0 flex-1 flex-col gap-4 p-3 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Database className="text-muted-foreground size-5 shrink-0" />
            <h1 className="text-foreground text-lg font-semibold tracking-tight md:text-xl">
              Vínculos e triagem
            </h1>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Sessão: {runTitle} · {summary.total.toLocaleString('pt-BR')}{' '}
            sugestões
            {filterByDay ? (
              <>
                {' '}
                · vencimento em{' '}
                {new Date(compareDate + 'T12:00:00').toLocaleDateString('pt-BR')}
              </>
            ) : (
              ' (todas as datas)'
            )}{' '}
            · empresa: {unitFilter}
          </p>
        </div>

        <div className="flex w-full flex-col items-stretch gap-2 sm:max-w-2xl sm:items-end">
          <div className="flex flex-wrap items-end justify-end gap-3 sm:justify-end">
            <>
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground text-[0.65rem] uppercase">
                    Pendentes
                  </span>
                  <button
                    type="button"
                    title={
                      statusFilter === 'pendente'
                        ? 'Mostrar todas as sugestões'
                        : 'Mostrar só itens pendentes'
                    }
                    aria-pressed={statusFilter === 'pendente'}
                    onClick={() => {
                      setStatusFilter((f) =>
                        f === 'pendente' ? 'todos' : 'pendente',
                      )
                      setSelectedIds(new Set())
                    }}
                    className={cn(
                      'focus-visible:ring-ring rounded-md p-0 text-left focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
                      statusFilter === 'pendente' &&
                        'ring-2 ring-amber-500/60 ring-offset-1',
                    )}
                  >
                    <Badge
                      variant="secondary"
                      className="h-7 w-full min-w-0 cursor-pointer border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-200"
                    >
                      {summary.pendente.toLocaleString('pt-BR')} pendentes
                    </Badge>
                  </button>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground text-[0.65rem] uppercase">
                    Conferido
                  </span>
                  <button
                    type="button"
                    title={
                      statusFilter === 'conferido'
                        ? 'Mostrar todas as sugestões'
                        : 'Mostrar só itens conferidos (ainda não pagos)'
                    }
                    aria-pressed={statusFilter === 'conferido'}
                    onClick={() => {
                      setStatusFilter((f) =>
                        f === 'conferido' ? 'todos' : 'conferido',
                      )
                      setSelectedIds(new Set())
                    }}
                    className={cn(
                      'focus-visible:ring-ring rounded-md p-0 text-left focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
                      statusFilter === 'conferido' &&
                        'ring-2 ring-emerald-500/60 ring-offset-1',
                    )}
                  >
                    <Badge
                      variant="secondary"
                      className="h-7 w-full min-w-0 cursor-pointer border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-200"
                    >
                      {summary.conferido.toLocaleString('pt-BR')} conferido
                    </Badge>
                  </button>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground text-[0.65rem] uppercase">
                    Pago
                  </span>
                  <button
                    type="button"
                    title={
                      statusFilter === 'pago'
                        ? 'Mostrar todas as sugestões'
                        : 'Mostrar só itens marcados como pago'
                    }
                    aria-pressed={statusFilter === 'pago'}
                    onClick={() => {
                      setStatusFilter((f) => (f === 'pago' ? 'todos' : 'pago'))
                      setSelectedIds(new Set())
                    }}
                    className={cn(
                      'focus-visible:ring-ring rounded-md p-0 text-left focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
                      statusFilter === 'pago' &&
                        'ring-2 ring-violet-500/60 ring-offset-1',
                    )}
                  >
                    <Badge
                      variant="secondary"
                      className="h-7 w-full min-w-0 cursor-pointer border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-900/50 dark:bg-violet-950/50 dark:text-violet-200"
                    >
                      {summary.pago.toLocaleString('pt-BR')} pago
                    </Badge>
                  </button>
                </div>
            </>
            <div className="flex min-w-[12rem] flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label
                  htmlFor="compare-date"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Dia do comparativo
                </Label>
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="h-auto px-0 text-[0.7rem] font-normal"
                  onClick={() => {
                    setFilterByDay((v) => !v)
                    setSelectedIds(new Set())
                  }}
                >
                  {filterByDay ? 'Ver todas as datas' : 'Filtrar por dia'}
                </Button>
              </div>
              <Input
                id="compare-date"
                type="date"
                value={compareDate}
                disabled={!filterByDay}
                onChange={(e) => {
                  setCompareDate(e.target.value)
                  setSelectedIds(new Set())
                }}
                className="h-9 w-full font-mono text-sm"
              />
            </div>
            <div className="flex w-full min-w-0 flex-col gap-0.5 sm:max-w-[20rem]">
              <span className="text-muted-foreground text-[0.65rem] uppercase">
                Empresa
              </span>
              <div className="flex w-full min-w-0 flex-wrap justify-end gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn(
                    'h-9',
                    unitFilter === 'PEDERTRACTOR' &&
                      'ring-2 ring-sky-500/60 ring-offset-1',
                  )}
                  title="Só PEDERTRACTOR"
                  aria-pressed={unitFilter === 'PEDERTRACTOR'}
                  onClick={() => {
                    setUnitFilter('PEDERTRACTOR')
                    setSelectedIds(new Set())
                  }}
                >
                  PEDERTRACTOR
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn(
                    'h-9',
                    unitFilter === 'TRACTOR' &&
                      'ring-2 ring-sky-500/60 ring-offset-1',
                  )}
                  title="Só TRACTOR"
                  aria-pressed={unitFilter === 'TRACTOR'}
                  onClick={() => {
                    setUnitFilter('TRACTOR')
                    setSelectedIds(new Set())
                  }}
                >
                  TRACTOR
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isError && (
        <p className="text-destructive text-sm" role="alert">
          {error instanceof Error
            ? error.message
            : 'Não foi possível carregar as sugestões.'}
        </p>
      )}
      {confirmBatchMutation.isError && (
        <p className="text-destructive text-sm" role="alert">
          {confirmBatchMutation.error instanceof Error
            ? confirmBatchMutation.error.message
            : 'Não foi possível confirmar as sugestões selecionadas.'}
        </p>
      )}

      <Card className="border-border/60 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-muted-foreground p-4 text-sm">Carregando…</p>
          ) : (
            <div className="max-w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-muted-foreground w-8 px-1 text-center text-xs">
                      {displayRows.length > 0 ? (
                        <input
                          ref={headerSelectRef}
                          type="checkbox"
                          className="border-input accent-primary size-3.5 cursor-pointer rounded border"
                          checked={allOnPageSelected}
                          onChange={toggleSelectAllOnPage}
                          onClick={(e) => e.stopPropagation()}
                          title="Selecionar todas as linhas visíveis"
                          aria-label="Selecionar todas as linhas visíveis"
                        />
                      ) : null}
                    </TableHead>
                    <TableHead className="w-20 pl-2 pr-1 font-mono text-xs">
                      <SortableTh
                        label="#"
                        active={tableSort?.column === 'index'}
                        direction={tableSort?.column === 'index' ? tableSort.dir : null}
                        onClick={cycleSortIndex}
                        screenReaderHint="Ordena a lista pela ordem original. A coluna # mostra sempre o número de linha original (1…n) de cada registro."
                      />
                    </TableHead>
                    <TableHead className="min-w-40 text-xs">Externo (banco)</TableHead>
                    <TableHead className="min-w-40 text-xs">Interno (ERP)</TableHead>
                    <TableHead className="min-w-[6.5rem] whitespace-nowrap text-xs">
                      Vencimento
                    </TableHead>
                    <TableHead className="min-w-[14rem] whitespace-nowrap text-right text-xs">
                      <div className="flex justify-end">
                        <SortableTh
                          label="Banco / ERP"
                          className="justify-end"
                          active={tableSort?.column === 'amount'}
                          direction={
                            tableSort?.column === 'amount' ? tableSort.dir : null
                          }
                          onClick={cycleSortAmount}
                          screenReaderHint="Ordenar pelo valor do banco (ou interno se não houver banco). Maior para menor, menor para maior ou padrão."
                        />
                      </div>
                    </TableHead>
                    <TableHead className="min-w-[8rem] text-xs">
                      Motivo / diferença
                    </TableHead>
                    <TableHead className="w-24 text-xs">Status</TableHead>
                    <TableHead className="w-16 min-w-14 text-right text-xs">
                      Ações
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="text-muted-foreground p-6 text-center text-sm"
                      >
                        {runId == null ? (
                          'Não há itens a exibir.'
                        ) : filterByDay ? (
                          <span className="inline-flex flex-col items-center gap-3 sm:inline-flex sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-1">
                            <span>
                              Nenhuma sugestão com vencimento em{' '}
                              {new Date(compareDate + 'T12:00:00').toLocaleDateString(
                                'pt-BR',
                              )}
                              . Os lançamentos podem estar noutro dia (ou sem data de
                              vencimento).
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setFilterByDay(false)
                                setSelectedIds(new Set())
                              }}
                            >
                              Ver todas as datas
                            </Button>
                          </span>
                        ) : (
                          <>
                            Nenhuma sugestão para esta execução. Quando a conciliação
                            automática passar a gerar sugestões, elas aparecerão aqui.
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    displayRows.map((item, idx) => {
                      const row = item.row
                      const isSel = selectedIds.has(row.id)
                      return (
                        <TableRow
                          key={row.id}
                          data-state={isSel ? 'selected' : undefined}
                          role="button"
                          tabIndex={0}
                          aria-label={`Abrir detalhe da sugestão (linha ${item.line})`}
                          onClick={() => {
                            setSuggestionDetail({ row, line: item.line })
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setSuggestionDetail({ row, line: item.line })
                            }
                          }}
                          className={cn(
                            'border-border/40',
                            'cursor-pointer',
                            idx % 2 === 0 ? 'bg-card' : 'bg-muted/30',
                            isSel &&
                              'bg-sky-50 dark:bg-sky-950/40',
                          )}
                        >
                          <TableCell
                            className="w-8 px-1"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.stopPropagation()
                              }
                            }}
                          >
                            <input
                              type="checkbox"
                              className="border-input accent-primary size-3.5 cursor-pointer rounded border"
                              checked={isSel}
                              onChange={() => {
                                toggleSelectedId(row.id)
                              }}
                              aria-label={`Selecionar linha ${item.line}`}
                            />
                          </TableCell>
                          <TableCell className="text-muted-foreground w-20 pl-3 pr-1 font-mono text-xs">
                            {item.line}
                          </TableCell>
                          <TableCell className="max-w-56 truncate text-sm">
                            {row.externalName}
                          </TableCell>
                          <TableCell className="max-w-56 truncate text-sm">
                            {row.internalName}
                          </TableCell>
                          <TableCell
                            className="text-muted-foreground min-w-[6.5rem] whitespace-nowrap font-mono text-xs tabular-nums"
                            title={row.dueDate ? undefined : 'Sem data de vencimento'}
                          >
                            {formatDatePt(row.dueDate)}
                          </TableCell>
                          <TableCell
                            className="min-w-56 whitespace-normal break-words text-right font-mono text-sm leading-snug tabular-nums"
                            title={bancoBarraInternoText(row)}
                          >
                            <span className="text-foreground">
                              {formatBrlAmount(row.amountBank ?? null)}
                            </span>
                            <span className="text-muted-foreground mx-1">/</span>
                            <span className="text-foreground">
                              {formatBrlAmount(row.amountInternal ?? null)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <MotivoDiffCell row={row} />
                          </TableCell>
                          <TableCell>
                            <StatusCell row={row} />
                          </TableCell>
                          <TableCell
                            className="text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="inline-flex items-center justify-end gap-1">
                              {getSuggestionStatus(row) === 'APPROVED' &&
                              getApprovedPaymentVinculoKind(row) === 'PIX' ? (
                                <Tooltip>
                                  <TooltipTrigger
                                    render={<span className="inline-flex" />}
                                  >
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      className={cn(
                                        'h-7 w-7',
                                        row.vinculoRegistry?.hasDetails
                                          ? 'text-teal-600 hover:text-teal-700 dark:text-teal-400'
                                          : 'text-muted-foreground/60 opacity-60 hover:opacity-100',
                                      )}
                                      aria-label="Instrução de pagamento PIX"
                                      disabled={!runId}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (runId) {
                                          setPaymentInstructionId(row.id)
                                        }
                                      }}
                                    >
                                      <QrCode className="size-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[16rem] text-xs">
                                    {row.vinculoRegistry?.hasDetails
                                      ? 'Abrir valor, vencimento e dados do PIX'
                                      : 'Sem cadastro completo em PIX & TED: clique para ver valor e vencimento, e complete o cadastro no menu lateral.'}
                                  </TooltipContent>
                                </Tooltip>
                              ) : null}
                              {getSuggestionStatus(row) === 'APPROVED' &&
                              getApprovedPaymentVinculoKind(row) === 'TED' ? (
                                <Tooltip>
                                  <TooltipTrigger
                                    render={<span className="inline-flex" />}
                                  >
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      className={cn(
                                        'h-7 w-7',
                                        row.vinculoRegistry?.hasDetails
                                          ? 'text-sky-600 hover:text-sky-700 dark:text-sky-400'
                                          : 'text-muted-foreground/60 opacity-60 hover:opacity-100',
                                      )}
                                      aria-label="Instrução de pagamento TED"
                                      disabled={!runId}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (runId) {
                                          setPaymentInstructionId(row.id)
                                        }
                                      }}
                                    >
                                      <Landmark className="size-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[16rem] text-xs">
                                    {row.vinculoRegistry?.hasDetails
                                      ? 'Abrir valor, vencimento e dados bancários do TED'
                                      : 'Sem cadastro completo em PIX & TED: clique para ver valor e vencimento, e complete o cadastro no menu lateral.'}
                                  </TooltipContent>
                                </Tooltip>
                              ) : null}
                              {getSuggestionStatus(row) === 'APPROVED' &&
                              getApprovedPaymentVinculoKind(row) == null ? (
                                isSuggestionMarkedPaid(row) ? (
                                  <Tooltip>
                                    <TooltipTrigger
                                      render={<span className="inline-flex" />}
                                    >
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        className="text-emerald-600 hover:text-emerald-700 h-7 w-7 dark:text-emerald-400"
                                        aria-label="Ver data do pagamento"
                                        disabled={!runId}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setPaidInfoRow(row)
                                        }}
                                      >
                                        <Banknote className="size-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-[16rem] text-xs">
                                      Clique para ver a data do pagamento
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <Tooltip>
                                    <TooltipTrigger
                                      render={<span className="inline-flex" />}
                                    >
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        className="text-amber-700 hover:text-amber-800 h-7 w-7 dark:text-amber-400"
                                        aria-label="Clique para confirmar pagamento"
                                        disabled={!runId}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setMarkPaidForRow(row)
                                        }}
                                      >
                                        <Banknote className="size-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-[16rem] text-xs">
                                      Clique para confirmar pagamento
                                    </TooltipContent>
                                  </Tooltip>
                                )
                              ) : null}
                              {isSel && canShowConfirmA(row) ? (
                                <Tooltip>
                                  <TooltipTrigger
                                    render={<span className="inline-flex" />}
                                  >
                                    <Button
                                      type="button"
                                      size="icon-sm"
                                      variant="outline"
                                      className="h-7 w-7 p-0 font-mono text-[0.7rem] shadow-none"
                                      disabled={confirmBatchMutation.isPending}
                                      onClick={() => {
                                        confirmBatchMutation.mutate([row.id])
                                      }}
                                      aria-label="Confirmar (A)"
                                    >
                                      A
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent className="text-xs">
                                    {selectedIds.size > 1
                                      ? 'Confirma só esta linha; a tecla A confirma o grupo selecionado'
                                      : 'Confirmar como conferido (tecla A)'}
                                  </TooltipContent>
                                </Tooltip>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <footer className="text-muted-foreground border-border/60 flex w-full min-w-0 flex-col gap-2 border-t pt-2 text-xs md:flex-row md:items-center">
        <div className="font-mono min-w-0 shrink-0">
          <span>Total: {summary.total}</span>
          <span className="mx-2">·</span>
          <span>Exibindo: {displayRows.length} linha(s)</span>
          <span className="mx-2">·</span>
          <span>Selecionado: {selectedIds.size}</span>
          {selectedIds.size > 0 ? (
            <span>
              <span className="mx-2">·</span>
              <span>com ação A: {selectedConfirmableIds.length}</span>
            </span>
          ) : null}
        </div>
        {rows.length > 0 ? (
          <div
            className="font-mono flex min-w-0 flex-1 justify-center px-2 text-center tabular-nums"
            title="Soma dos valores banco e ERP (linhas exibidas)"
          >
            Banco / ERP: {displayAmountTotals.bankText} /{' '}
            {displayAmountTotals.internalText}
          </div>
        ) : null}
        <div
          className={cn(
            'flex min-w-0 items-center gap-1.5',
            rows.length === 0 && 'md:ml-auto',
          )}
        >
          <Zap className="size-3.5 shrink-0" />
          <span>
            Sugestões fortes (≥80%): ~{highConfidencePct}%{' '}
            {rows.length === 0 ? '' : 'do conjunto exibido'}
          </span>
        </div>
      </footer>

      <AccountPaidConfirmDialog
        open={markPaidForRow != null}
        onOpenChange={(open) => {
          if (!open) {
            setMarkPaidForRow(null)
          }
        }}
        isPending={markPaidMutation.isPending}
        onConfirmYes={() => {
          if (markPaidForRow) {
            markPaidMutation.mutate(markPaidForRow.id)
          }
        }}
      />

      <Dialog
        open={paidInfoRow != null}
        onOpenChange={(open) => {
          if (!open) {
            setPaidInfoRow(null)
          }
        }}
      >
        <DialogContent
          className="max-w-md gap-0 p-0 sm:max-w-md"
          showCloseButton
        >
          <div className="p-5 sm:p-6">
            <DialogHeader className="p-0">
              <DialogTitle>Conta paga</DialogTitle>
              <DialogDescription>
                Pagamento registrado em{' '}
                <span className="text-foreground font-medium">
                  {formatDateTimePtBr(paidInfoRow?.paidAt)}
                </span>
                .
              </DialogDescription>
            </DialogHeader>
            <div className="mt-6 flex justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPaidInfoRow(null)}
              >
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <PaymentInstructionModal
        runId={runId ?? null}
        suggestionId={paymentInstructionId}
        open={paymentInstructionId != null}
        onOpenChange={(open) => {
          if (!open) {
            setPaymentInstructionId(null)
          }
        }}
      />

      <SuggestionDetailModal
        runId={runId}
        open={suggestionDetail != null}
        row={suggestionDetail?.row ?? null}
        line={suggestionDetail?.line ?? null}
        onOpenChange={(next) => {
          if (!next) {
            setSuggestionDetail(null)
          }
        }}
        onResolved={() => {
          if (runId) {
            queryClient.invalidateQueries({
              queryKey: ['reconciliation-suggestions', unitFilter, runId],
            })
          }
          setSuggestionDetail(null)
        }}
      />
    </div>
  );
}

function SortableTh({
  label,
  active,
  direction,
  onClick,
  className,
  screenReaderHint,
}: {
  label: string
  active: boolean
  direction: SortDir | null
  onClick: () => void
  className?: string
  screenReaderHint: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={onClick}
      className={cn(
        'text-muted-foreground -mx-1.5 h-7 gap-1 font-mono font-medium tracking-wide',
        active && 'text-foreground',
        className,
      )}
    >
      <span className="uppercase leading-none">{label}</span>
      {active && direction != null ? (
        direction === 'asc' ? (
          <ArrowUp className="size-3.5 opacity-100" />
        ) : (
          <ArrowDown className="size-3.5 opacity-100" />
        )
      ) : (
        <ArrowUpDown className="text-muted-foreground/45 size-3.5" aria-hidden />
      )}
      <span className="sr-only">{screenReaderHint}</span>
    </Button>
  )
}
