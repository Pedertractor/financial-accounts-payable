import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Loader2,
  Trash2,
  UploadCloud,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from '@/components/ui/pagination'
import { Progress } from '@/components/ui/progress'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  type FileUploadStatus,
  cancelStagedFileUpload,
  confirmStagedFileUpload,
  deleteImportRecords,
  finalizeReconciliationRun,
  getReconciliationRun,
  listRecentFileUploads,
  pollFileUpload,
  reconciliationRunDetailQk,
  uploadReconciliationFile,
} from '@/lib/api'
import {
  importReconciliationRunQueryKey,
  resolveImportReconciliationRunId,
} from '@/lib/reconcile-run-session'
import {
  clearStoredReconciliationRunId,
  getStoredConciliationUnitForImport,
  setStoredConciliationUnit,
  type ConciliationUnit,
} from '@/lib/reconcile-storage'
import { cn } from '@/lib/utils'
import { ReconciliationRunControls } from '@/components/reconciliation-run-controls'

type TrackState = {
  fileName: string | null
  fileUploadId: string | null
  uploadPercent: number
  processPercent: number
  status:
    | 'idle'
    | 'uploading'
    | 'processing'
    | 'done'
    | 'error'
    | 'partial'
    | 'awaitingConfirm'
  error: string | null
  warningSamples: { row: number; text: string }[]
  importPreviewCount: number | null
  rejectedCount: number | null
  skippedCount: number | null
  updatedCount: number | null
  isReimport: boolean
}

const initial: TrackState = {
  fileName: null,
  fileUploadId: null,
  uploadPercent: 0,
  processPercent: 0,
  status: 'idle',
  error: null,
  warningSamples: [],
  importPreviewCount: null,
  rejectedCount: null,
  skippedCount: null,
  updatedCount: null,
  isReimport: false,
}

const recentUploadsKey = ['reconciliation', 'uploads', 'recent'] as const

function sourceLabel(t: string): string {
  if (t === 'BANK') return 'Banco'
  if (t === 'INTERNAL') return 'Interno'
  return t
}

function statusLine(u: FileUploadStatus): string {
  if (u.status === 'FAILED') return 'Falhou'
  if (u.status === 'PARTIAL_SUCCESS') return 'Concluído com avisos'
  if (u.status === 'COMPLETED') return 'Concluído'
  if (u.status === 'AWAITING_CONFIRM') return 'Aguardando confirmação (nada gravado ainda)'
  if (u.status === 'CANCELLED') return 'Cancelada'
  return u.status
}

function rowCountLabel(u: FileUploadStatus): string {
  const parts: string[] = []
  if (u.totalRowsImported != null && u.totalRowsImported > 0) {
    parts.push(
      `${u.totalRowsImported.toLocaleString('pt-BR')} ${u.totalRowsImported === 1 ? 'nova' : 'novas'}`,
    )
  }
  if (u.totalRowsUpdated != null && u.totalRowsUpdated > 0) {
    parts.push(
      `${u.totalRowsUpdated.toLocaleString('pt-BR')} ${u.totalRowsUpdated === 1 ? 'atualizada' : 'atualizadas'}`,
    )
  }
  if (u.totalRowsSkipped != null && u.totalRowsSkipped > 0) {
    parts.push(
      `${u.totalRowsSkipped.toLocaleString('pt-BR')} ${u.totalRowsSkipped === 1 ? 'ignorada (já existia)' : 'ignoradas (já existiam)'}`,
    )
  }
  if (parts.length) return parts.join(' · ')
  if (u.totalRowsImported != null) {
    return `${u.totalRowsImported.toLocaleString('pt-BR')} ${u.totalRowsImported === 1 ? 'linha' : 'linhas'}`
  }
  if (u.totalRowsRead != null) {
    return `${u.totalRowsRead.toLocaleString('pt-BR')} ${u.totalRowsRead === 1 ? 'linha' : 'linhas'} (lidas)`
  }
  return '—'
}

function dedupSummaryLine(t: TrackState): string | null {
  const parts: string[] = []
  if (t.importPreviewCount != null && t.importPreviewCount > 0) {
    parts.push(
      `${t.importPreviewCount.toLocaleString('pt-BR')} ${t.importPreviewCount === 1 ? 'nova' : 'novas'}`,
    )
  }
  if (t.updatedCount != null && t.updatedCount > 0) {
    parts.push(
      `${t.updatedCount.toLocaleString('pt-BR')} ${t.updatedCount === 1 ? 'atualizada' : 'atualizadas'}`,
    )
  }
  if (t.skippedCount != null && t.skippedCount > 0) {
    parts.push(
      `${t.skippedCount.toLocaleString('pt-BR')} ${t.skippedCount === 1 ? 'ignorada (já existia)' : 'ignoradas (já existiam)'}`,
    )
  }
  if (!parts.length) return null
  const base = parts.join(' · ')
  return t.isReimport ? `${base} — reimportação detectada` : base
}

const RECENT_IMPORTS_PAGE_SIZE = 5

function formatFinishedAt(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

function combinedBar(t: TrackState): number {
  if (t.status === 'idle') return 0
  if (t.status === 'uploading') {
    return Math.round(t.uploadPercent * 0.5)
  }
  return 50 + Math.round(t.processPercent * 0.5)
}

function badgeFor(t: TrackState) {
  if (t.status === 'error') {
    return <Badge variant="destructive">ERRO</Badge>
  }
  if (t.status === 'awaitingConfirm') {
    return (
      <Badge
        className="border-amber-500/30 bg-amber-500/15 text-amber-900 dark:text-amber-200"
        variant="secondary"
      >
        CONFIRMAR
      </Badge>
    )
  }
  if (t.status === 'done' || t.status === 'partial') {
    return (
      <Badge
        className="border-emerald-600/30 bg-emerald-600/15 text-emerald-800 dark:text-emerald-200"
        variant="secondary"
      >
        {t.status === 'partial' ? 'PARCIAL' : 'SUCESSO'}
      </Badge>
    )
  }
  if (t.status === 'uploading') {
    return <Badge variant="secondary">ENVIANDO</Badge>
  }
  if (t.status === 'processing') {
    return (
      <Badge className="bg-blue-600/15 text-blue-800 dark:text-blue-200" variant="secondary">
        PROCESSANDO
      </Badge>
    )
  }
  return <Badge variant="outline">—</Badge>
}

function DropCard({
  title,
  description,
  icon: Icon,
  inputId,
  onPick,
  disabled,
}: {
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  inputId: string
  onPick: (f: File) => void
  disabled: boolean
}) {
  const [drag, setDrag] = useState(false)
  return (
    <Card className="border-dashed">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
            <Icon className="text-muted-foreground size-5" />
          </div>
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="text-sm">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <input
          id={inputId}
          type="file"
          className="hidden"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={disabled}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onPick(f)
            e.target.value = ''
          }}
        />
        <label htmlFor={inputId}>
          <div
            className={cn(
              'border-border bg-background/50 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-10 text-center transition-colors',
              disabled && 'pointer-events-none opacity-50',
              drag && 'bg-muted/50 border-foreground/30',
            )}
            onDragOver={(e) => {
              e.preventDefault()
              if (!disabled) setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              if (disabled) return
              const f = e.dataTransfer.files?.[0]
              if (f) onPick(f)
            }}
          >
            <UploadCloud className="text-muted-foreground mb-2 size-8" />
            <p className="text-sm font-medium">Arraste o arquivo ou clique para selecionar</p>
            <p className="text-muted-foreground mt-1 text-xs">.xlsx, .xls, .csv · até 10 MB</p>
          </div>
        </label>
      </CardContent>
    </Card>
  )
}

function RowList({
  label,
  t,
  onRemove,
  onConfirmStaged,
  onDiscardStaged,
  confirmLoading,
  discardLoading,
  removeImportLoading,
}: {
  label: string
  t: TrackState
  onRemove: () => void
  onConfirmStaged: () => void
  onDiscardStaged: () => void
  confirmLoading: boolean
  discardLoading: boolean
  removeImportLoading: boolean
}) {
  if (!t.fileName) return null
  return (
    <div className="border-border flex flex-col gap-3 border-b py-3 last:border-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{t.fileName}</p>
          {t.error ? <p className="text-destructive mt-1 text-xs">{t.error}</p> : null}
          {(t.status === 'done' || t.status === 'partial') && dedupSummaryLine(t) ? (
            <p className="text-muted-foreground mt-1 text-xs">{dedupSummaryLine(t)}</p>
          ) : null}
          {t.status === 'awaitingConfirm' ? (
            <p className="text-muted-foreground mt-1.5 text-xs">
              A planilha tem linhas com problema. Nada foi gravado no banco ainda. Revise o que
              seria ignorado, depois confirme para importar só as linhas válidas ou descarte.
            </p>
          ) : null}
          <div className="mt-2 space-y-1.5">
            {t.status !== 'idle' ? (
              <Progress
                className="h-2"
                value={t.status === 'error' ? 0 : combinedBar(t)}
              />
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badgeFor(t)}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="text-muted-foreground"
            onClick={onRemove}
            disabled={
              t.status === 'processing' ||
              t.status === 'uploading' ||
              discardLoading ||
              removeImportLoading
            }
            aria-label={`Remover ${label}`}
          >
            {t.status === 'processing' || t.status === 'uploading' ? (
              <XCircle className="size-4" />
            ) : (
              <Trash2 className="size-4" />
            )}
          </Button>
        </div>
      </div>
      {t.status === 'awaitingConfirm' && t.fileUploadId ? (
        <div className="bg-muted/30 space-y-2 rounded-md border p-3">
          <p className="text-sm">
            {dedupSummaryLine(t) ??
              (t.importPreviewCount != null
                ? `${t.importPreviewCount.toLocaleString('pt-BR')} ${t.importPreviewCount === 1 ? 'linha' : 'linhas'} a importar`
                : 'Linhas a importar')}
            {t.rejectedCount != null
              ? ` · ${t.rejectedCount.toLocaleString('pt-BR')} ${t.rejectedCount === 1 ? 'rejeitada' : 'rejeitadas'} (inválidas)`
              : null}
            {t.warningSamples.length < (t.rejectedCount ?? 0) ? ' (amostra abaixo; até 30 linhas)' : null}
          </p>
          {t.warningSamples.length > 0 ? (
            <Collapsible>
              <CollapsibleTrigger className="text-foreground/90 hover:text-foreground flex w-full items-center justify-between text-left text-sm font-medium">
                <span>Linhas rejeitadas (amostra)</span>
                <ChevronDown className="text-muted-foreground size-4 shrink-0" />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <ul className="text-muted-foreground list-inside list-disc space-y-0.5 text-xs">
                  {t.warningSamples.map((w, i) => (
                    <li key={`${w.row}-${i}`}>
                      <span className="font-mono">Linha {w.row}:</span> {w.text}
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              onClick={onConfirmStaged}
              disabled={confirmLoading || discardLoading || removeImportLoading}
            >
              {confirmLoading ? 'Salvando…' : 'Confirmar importação'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onDiscardStaged}
              disabled={confirmLoading || discardLoading || removeImportLoading}
            >
              {discardLoading ? 'Descartando…' : 'Descartar'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const UNITS: readonly ConciliationUnit[] = ['PEDERTRACTOR', 'TRACTOR'] as const

function CompanyUnitPicker({
  label,
  value,
  onSelect,
}: {
  label: string
  value: ConciliationUnit | null
  onSelect: (u: ConciliationUnit) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex max-w-md gap-2">
        {UNITS.map((u) => (
          <Button
            key={u}
            type="button"
            variant={value === u ? 'default' : 'outline'}
            className="min-w-0 flex-1"
            onClick={() => {
              if (value !== u) onSelect(u)
            }}
          >
            {u}
          </Button>
        ))}
      </div>
    </div>
  )
}

export function ImportDataPage() {
  const queryClient = useQueryClient()
  const [importUnit, setImportUnit] = useState<ConciliationUnit | null>(() =>
    getStoredConciliationUnitForImport(),
  )
  const [bank, setBank] = useState<TrackState>(initial)
  const [internal, setInternal] = useState<TrackState>(initial)
  const [vinculoSuccess, setVinculoSuccess] = useState(false)
  const [vinculoSuccessMessage, setVinculoSuccessMessage] = useState<string | null>(null)

  const { data: runId, isLoading: runLoading } = useQuery({
    queryKey: importUnit != null ? importReconciliationRunQueryKey(importUnit) : ['reconciliation-run', 'import-page', 'none'],
    queryFn: ({ signal }) => resolveImportReconciliationRunId(importUnit!, signal),
    enabled: importUnit != null,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const { data: activeRunData } = useQuery({
    queryKey: reconciliationRunDetailQk(runId ?? ''),
    queryFn: () => getReconciliationRun(runId!),
    enabled: runId != null,
  })

  const runClosed = activeRunData?.run.status === 'CLOSED'

  function handleRunChanged(newRunId: string) {
    setBank(initial)
    setInternal(initial)
    setVinculoSuccess(false)
    setVinculoSuccessMessage(null)
    if (importUnit) {
      queryClient.setQueryData(importReconciliationRunQueryKey(importUnit), newRunId)
    }
  }

  function handleImportUnitChange(u: ConciliationUnit) {
    setImportUnit(u)
    setStoredConciliationUnit(u)
    setBank(initial)
    setInternal(initial)
    setVinculoSuccess(false)
    setVinculoSuccessMessage(null)
    clearStoredReconciliationRunId()
    void queryClient.invalidateQueries({ queryKey: importReconciliationRunQueryKey(u) })
  }

  const { data: recentData, isLoading: recentLoading } = useQuery({
    queryKey: recentUploadsKey,
    queryFn: () => listRecentFileUploads({ limit: 30 }),
  })

  const [recentPage, setRecentPage] = useState(0)
  const allUploads = recentData?.uploads ?? []
  const recentTotalPages =
    allUploads.length > 0
      ? Math.max(1, Math.ceil(allUploads.length / RECENT_IMPORTS_PAGE_SIZE))
      : 0
  const maxPageIndex = recentTotalPages > 0 ? recentTotalPages - 1 : 0
  const effectiveRecentPage = Math.min(recentPage, maxPageIndex)

  const pagedUploads = allUploads.slice(
    effectiveRecentPage * RECENT_IMPORTS_PAGE_SIZE,
    (effectiveRecentPage + 1) * RECENT_IMPORTS_PAGE_SIZE,
  )
  const rangeStart = allUploads.length === 0 ? 0 : effectiveRecentPage * RECENT_IMPORTS_PAGE_SIZE + 1
  const rangeEnd = Math.min(
    (effectiveRecentPage + 1) * RECENT_IMPORTS_PAGE_SIZE,
    allUploads.length,
  )

  const confirmStagedMutation = useMutation({
    mutationFn: (p: { fileUploadId: string; kind: 'bank' | 'internal' }) =>
      confirmStagedFileUpload(p.fileUploadId),
    onSuccess: (data, p) => {
      const u = data.fileUpload
      const set = p.kind === 'bank' ? setBank : setInternal
      const st: TrackState['status'] =
        u.status === 'FAILED'
          ? 'error'
          : u.status === 'PARTIAL_SUCCESS'
            ? 'partial'
            : u.status === 'COMPLETED'
              ? 'done'
              : 'error'
      set((s) => ({
        ...s,
        processPercent: 100,
        status: st,
        error: u.errorMessage,
        warningSamples: u.warningDetails?.samples ?? [],
        importPreviewCount: u.totalRowsImported,
        rejectedCount: u.totalRowsRejected,
        skippedCount: u.totalRowsSkipped,
        updatedCount: u.totalRowsUpdated,
        isReimport: u.isReimport ?? false,
      }))
      void queryClient.invalidateQueries({ queryKey: recentUploadsKey })
    },
    onError: (e, p) => {
      const set = p.kind === 'bank' ? setBank : setInternal
      set((s) => ({
        ...s,
        error: e instanceof Error ? e.message : 'Não foi possível confirmar a importação',
      }))
    },
  })

  const discardStagedMutation = useMutation({
    mutationFn: (p: { fileUploadId: string; kind: 'bank' | 'internal' }) =>
      cancelStagedFileUpload(p.fileUploadId),
    onSuccess: (_d, p) => {
      const set = p.kind === 'bank' ? setBank : setInternal
      set(initial)
      void queryClient.invalidateQueries({ queryKey: recentUploadsKey })
    },
  })

  const removeImportMutation = useMutation({
    mutationFn: (p: { fileUploadId: string; kind: 'bank' | 'internal' }) =>
      deleteImportRecords(p.fileUploadId),
    onSuccess: (_d, p) => {
      const set = p.kind === 'bank' ? setBank : setInternal
      set(initial)
      void queryClient.invalidateQueries({ queryKey: recentUploadsKey })
    },
    onError: (e, p) => {
      const set = p.kind === 'bank' ? setBank : setInternal
      set((s) => ({
        ...s,
        error: e instanceof Error ? e.message : 'Não foi possível remover os dados importados',
      }))
    },
  })

  const finalizeImportMutation = useMutation({
    mutationFn: () => {
      if (!runId) {
        throw new Error('Execução de conciliação indisponível')
      }
      return finalizeReconciliationRun(runId)
    },
    onSuccess: (data) => {
      setVinculoSuccess(true)
      setVinculoSuccessMessage(data.message)
      void queryClient.invalidateQueries({ queryKey: ['reconciliation-suggestions'] })
      void queryClient.invalidateQueries({ queryKey: ['reconciliation-run', 'vinculos'] })
      void queryClient.invalidateQueries({ queryKey: ['reconciliation-run', 'import-page'] })
    },
  })

  useEffect(() => {
    if (!vinculoSuccess) {
      return
    }
    const id = window.setTimeout(() => {
      setBank(initial)
      setInternal(initial)
      setVinculoSuccess(false)
      setVinculoSuccessMessage(null)
      finalizeImportMutation.reset()
      void queryClient.invalidateQueries({ queryKey: recentUploadsKey })
    }, 5000)
    return () => window.clearTimeout(id)
    // Só reage ao término do match; evita reagendar o timer quando o objeto da mutation muda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vinculoSuccess])

  const uploadFileMutation = useMutation({
    mutationFn: async ({
      kind,
      file,
      run: activeRun,
    }: {
      kind: 'bank' | 'internal'
      file: File
      run: string
    }) => {
      const set = kind === 'bank' ? setBank : setInternal
      set({ ...initial, fileName: file.name, status: 'uploading', uploadPercent: 0, error: null })
      const { fileUploadId } = await uploadReconciliationFile(
        activeRun,
        kind,
        file,
        (n) => {
          set((p) => ({ ...p, fileName: file.name, status: 'uploading', uploadPercent: n }))
        },
      )
      set((p) => ({
        ...p,
        fileUploadId,
        status: 'processing',
        uploadPercent: 100,
        processPercent: 0,
      }))
      const onTick = (u: FileUploadStatus) => {
        set((p) => ({ ...p, processPercent: u.progressPercent }))
      }
      return pollFileUpload(fileUploadId, onTick, 500)
    },
    onError: (e, { file, kind }) => {
      const set = kind === 'bank' ? setBank : setInternal
      set((p) => ({
        ...p,
        fileName: file.name,
        status: 'error',
        error: e instanceof Error ? e.message : 'Falha na importação',
        uploadPercent: 0,
        warningSamples: [],
        importPreviewCount: null,
        rejectedCount: null,
        skippedCount: null,
        updatedCount: null,
        isReimport: false,
      }))
    },
    onSuccess: (u, { file, kind }) => {
      const set = kind === 'bank' ? setBank : setInternal
      set((p) => {
        if (u.status === 'AWAITING_CONFIRM') {
          return {
            ...p,
            fileName: file.name,
            fileUploadId: u.id,
            processPercent: u.progressPercent,
            status: 'awaitingConfirm',
            error: null,
            warningSamples: u.warningDetails?.samples ?? [],
            importPreviewCount: u.totalRowsImported,
            rejectedCount: u.totalRowsRejected,
            skippedCount: u.totalRowsSkipped,
            updatedCount: u.totalRowsUpdated,
            isReimport: u.isReimport ?? false,
          }
        }
        const st: TrackState['status'] =
          u.status === 'FAILED'
            ? 'error'
            : u.status === 'PARTIAL_SUCCESS'
              ? 'partial'
              : 'done'
        return {
          ...p,
          fileName: file.name,
          fileUploadId: u.id,
          processPercent: u.progressPercent,
          status: st,
          error: u.errorMessage,
          warningSamples: u.warningDetails?.samples ?? [],
          importPreviewCount: u.totalRowsImported,
          rejectedCount: u.totalRowsRejected,
          skippedCount: u.totalRowsSkipped,
          updatedCount: u.totalRowsUpdated,
          isReimport: u.isReimport ?? false,
        }
      })
      void queryClient.invalidateQueries({ queryKey: recentUploadsKey })
    },
  })

  function processFile(kind: 'bank' | 'internal', file: File) {
    if (!importUnit || !runId) return
    uploadFileMutation.mutate({ kind, file, run: runId })
  }

  const busy = importUnit == null || runLoading || !runId
  const readyCount = [bank, internal].filter((x) => x.status === 'done' || x.status === 'partial').length

  return (
    <div className="max-w-7xl p-4 md:p-6 lg:mx-auto">
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Importar Dados</h1>
          <p className="text-muted-foreground mt-1 w-full text-pretty text-sm">
            Envie e confirme a planilha do banco e/ou a do sistema interno (Epron). Escolha a{' '}
            <span className="text-foreground font-medium">empresa</span> antes de enviar as planilhas.
            Com ao menos uma planilha concluída, use{' '}
            <span className="text-foreground font-medium">Gerar vínculo</span> para gravar as sugestões
            no banco. Vínculos cruzados entre banco e interno exigem os dois lados. A triagem fica
            disponível em Conciliação a qualquer momento.
          </p>
        </div>
        {importUnit == null ? (
          <CompanyUnitPicker
            label="Empresa (obrigatório)"
            value={null}
            onSelect={handleImportUnitChange}
          />
        ) : runLoading || !runId ? (
          <p className="text-muted-foreground text-sm">Preparando execução de conciliação…</p>
        ) : (
          <div className="space-y-6">
            <CompanyUnitPicker
              label="Empresa"
              value={importUnit}
              onSelect={handleImportUnitChange}
            />
            <ReconciliationRunControls
              runId={runId}
              unit={importUnit}
              context="import"
              onRunChanged={handleRunChanged}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <DropCard
                title="Planilha do banco"
                description="Boletos a pagar no dia"
                icon={Building2}
                inputId="bank-in"
                disabled={
                  runClosed ||
                  !importUnit ||
                  bank.status === 'uploading' ||
                  bank.status === 'processing' ||
                  bank.status === 'awaitingConfirm' ||
                  (removeImportMutation.isPending &&
                    removeImportMutation.variables?.kind === 'bank') ||
                  (uploadFileMutation.isPending && uploadFileMutation.variables?.kind === 'bank')
                }
                onPick={(f) => void processFile('bank', f)}
              />
              <DropCard
                title="Extrato do sistema interno"
                description="Epron — lançamentos do período"
                icon={Database}
                inputId="internal-in"
                disabled={
                  runClosed ||
                  !importUnit ||
                  internal.status === 'uploading' ||
                  internal.status === 'processing' ||
                  internal.status === 'awaitingConfirm' ||
                  (removeImportMutation.isPending &&
                    removeImportMutation.variables?.kind === 'internal') ||
                  (uploadFileMutation.isPending && uploadFileMutation.variables?.kind === 'internal')
                }
                onPick={(f) => void processFile('internal', f)}
              />
            </div>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Arquivos carregados</CardTitle>
                <span className="text-muted-foreground text-xs">
                  {readyCount} de 2 planilhas concluídas (mín. 1 para gerar vínculo)
                </span>
              </CardHeader>
              <CardContent className="flex flex-col gap-0">
                {bank.fileName || internal.fileName ? (
                  <div className="min-w-0">
                    {bank.fileName ? (
                      <RowList
                        label="Banco"
                        t={bank}
                        onRemove={() => {
                          if (
                            bank.fileUploadId &&
                            (bank.status === 'awaitingConfirm' ||
                              bank.status === 'done' ||
                              bank.status === 'partial')
                          ) {
                            removeImportMutation.mutate({
                              fileUploadId: bank.fileUploadId,
                              kind: 'bank',
                            })
                            return
                          }
                          setBank(initial)
                        }}
                        onConfirmStaged={() => {
                          if (bank.fileUploadId) {
                            confirmStagedMutation.mutate({
                              fileUploadId: bank.fileUploadId,
                              kind: 'bank',
                            })
                          }
                        }}
                        onDiscardStaged={() => {
                          if (bank.fileUploadId) {
                            discardStagedMutation.mutate({
                              fileUploadId: bank.fileUploadId,
                              kind: 'bank',
                            })
                          }
                        }}
                        confirmLoading={
                          confirmStagedMutation.isPending &&
                          confirmStagedMutation.variables?.kind === 'bank'
                        }
                        discardLoading={
                          discardStagedMutation.isPending &&
                          discardStagedMutation.variables?.kind === 'bank'
                        }
                        removeImportLoading={
                          removeImportMutation.isPending &&
                          removeImportMutation.variables?.kind === 'bank'
                        }
                      />
                    ) : null}
                    {internal.fileName ? (
                      <RowList
                        label="Interno"
                        t={internal}
                        onRemove={() => {
                          if (
                            internal.fileUploadId &&
                            (internal.status === 'awaitingConfirm' ||
                              internal.status === 'done' ||
                              internal.status === 'partial')
                          ) {
                            removeImportMutation.mutate({
                              fileUploadId: internal.fileUploadId,
                              kind: 'internal',
                            })
                            return
                          }
                          setInternal(initial)
                        }}
                        onConfirmStaged={() => {
                          if (internal.fileUploadId) {
                            confirmStagedMutation.mutate({
                              fileUploadId: internal.fileUploadId,
                              kind: 'internal',
                            })
                          }
                        }}
                        onDiscardStaged={() => {
                          if (internal.fileUploadId) {
                            discardStagedMutation.mutate({
                              fileUploadId: internal.fileUploadId,
                              kind: 'internal',
                            })
                          }
                        }}
                        confirmLoading={
                          confirmStagedMutation.isPending &&
                          confirmStagedMutation.variables?.kind === 'internal'
                        }
                        discardLoading={
                          discardStagedMutation.isPending &&
                          discardStagedMutation.variables?.kind === 'internal'
                        }
                        removeImportLoading={
                          removeImportMutation.isPending &&
                          removeImportMutation.variables?.kind === 'internal'
                        }
                      />
                    ) : null}
                  </div>
                ) : (
                  <p className="text-muted-foreground py-6 text-center text-sm">Nenhum arquivo ainda.</p>
                )}
                <div className="border-border/60 mt-4 flex flex-col items-stretch gap-1.5 border-t pt-3 sm:items-end">
                  {finalizeImportMutation.isError ? (
                    <p
                      className="text-destructive max-w-full text-right text-xs"
                      role="alert"
                    >
                      {finalizeImportMutation.error instanceof Error
                        ? finalizeImportMutation.error.message
                        : 'Não foi possível gerar os vínculos.'}
                    </p>
                  ) : vinculoSuccess && vinculoSuccessMessage ? (
                    <p
                      className="max-w-full text-right text-xs text-emerald-700 dark:text-emerald-400"
                      role="status"
                    >
                      {vinculoSuccessMessage}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    className={cn(
                      'h-7 gap-1.5 self-end text-xs',
                      vinculoSuccess &&
                        'border-emerald-600/30 bg-emerald-600 text-white hover:bg-emerald-600 disabled:opacity-100',
                    )}
                    disabled={
                      importUnit == null ||
                      runClosed ||
                      readyCount < 1 ||
                      !runId ||
                      busy ||
                      finalizeImportMutation.isPending ||
                      vinculoSuccess
                    }
                    onClick={() => {
                      finalizeImportMutation.reset()
                      setVinculoSuccess(false)
                      setVinculoSuccessMessage(null)
                      void finalizeImportMutation.mutate()
                    }}
                  >
                    {finalizeImportMutation.isPending ? (
                      <Loader2
                        className="size-3.5 shrink-0 animate-spin"
                        aria-hidden
                      />
                    ) : vinculoSuccess ? (
                      <Check
                        className="size-3.5 shrink-0"
                        strokeWidth={2.5}
                        aria-hidden
                      />
                    ) : null}
                    {finalizeImportMutation.isPending
                      ? 'Gerando…'
                      : vinculoSuccess
                        ? 'Pronto'
                        : 'Gerar vínculo'}
                  </Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="space-y-1">
                <CardTitle className="text-base">Últimas importações</CardTitle>
                <p className="text-muted-foreground text-sm">
                  {recentLoading
                    ? 'Carregando histórico…'
                    : allUploads.length > 0
                      ? `Até ${allUploads.length} ${allUploads.length === 1 ? 'registro recente' : 'registros recentes'}`
                      : 'Nenhum histórico ainda'}
                </p>
              </CardHeader>
              <CardContent className="text-sm">
                {recentLoading ? (
                  <p className="text-muted-foreground text-sm">Carregando…</p>
                ) : pagedUploads.length > 0 ? (
                  <div className="space-y-4">
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[10%]">Origem</TableHead>
                            <TableHead className="w-[32%]">Arquivo</TableHead>
                            <TableHead className="w-[18%] whitespace-nowrap">Data/hora</TableHead>
                            <TableHead className="w-[22%]">Status</TableHead>
                            <TableHead className="w-[18%] text-right">Linhas</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pagedUploads.map((u) => (
                            <TableRow key={u.id}>
                              <TableCell className="font-medium">
                                {sourceLabel(u.sourceType)}
                              </TableCell>
                              <TableCell
                                className="min-w-0 max-w-56 truncate"
                                title={u.originalFileName}
                              >
                                {u.originalFileName}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-muted-foreground">
                                {formatFinishedAt(u.finishedAt ?? u.parsingStartedAt)}
                              </TableCell>
                              <TableCell>
                                <span
                                  className="line-clamp-2"
                                  title={statusLine(u)}
                                >
                                  {statusLine(u)}
                                </span>
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground tabular-nums">
                                {rowCountLabel(u)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {recentTotalPages > 1 ? (
                      <div className="flex flex-col items-center justify-between gap-3 sm:flex-row sm:items-center">
                        <p className="text-muted-foreground text-center text-xs sm:text-left">
                          {rangeStart}–{rangeEnd} de {allUploads.length}
                        </p>
                        <Pagination>
                          <PaginationContent>
                            <PaginationItem>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1 pl-2"
                                onClick={() =>
                                  setRecentPage((p) => {
                                    const cur = Math.min(p, maxPageIndex)
                                    return Math.max(0, cur - 1)
                                  })
                                }
                                disabled={effectiveRecentPage <= 0}
                                aria-label="Página anterior"
                              >
                                <ChevronLeft className="size-4" />
                                <span className="hidden sm:inline">Anterior</span>
                              </Button>
                            </PaginationItem>
                            <PaginationItem>
                              <span className="text-muted-foreground flex h-8 min-w-16 items-center justify-center px-2 text-xs">
                                {effectiveRecentPage + 1} / {recentTotalPages}
                              </span>
                            </PaginationItem>
                            <PaginationItem>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1 pr-2"
                                onClick={() =>
                                  setRecentPage((p) => {
                                    const cur = Math.min(p, maxPageIndex)
                                    return Math.min(maxPageIndex, cur + 1)
                                  })
                                }
                                disabled={effectiveRecentPage >= recentTotalPages - 1}
                                aria-label="Próxima página"
                              >
                                <span className="hidden sm:inline">Próxima</span>
                                <ChevronRight className="size-4" />
                              </Button>
                            </PaginationItem>
                          </PaginationContent>
                        </Pagination>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    O histórico de importações aparece aqui após a conclusão do processamento.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}