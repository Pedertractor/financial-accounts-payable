import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Building2,
  ChevronLeft,
  ChevronRight,
  Database,
  Eye,
  Loader2,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from '@/components/ui/pagination'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  type BankRunRecord,
  type InternalRunRecord,
  type ReconciliationRunListItem,
  type RunRecordType,
  deleteReconciliationRun,
  listReconciliationRuns,
  listRunRecords,
  reconciliationRunsListQk,
  requestInitWithTimeout,
  runRecordsQk,
} from '@/lib/api'
import { formatBrlAmount, formatDatePt, formatDateTimePt } from '@/lib/format'
import {
  type ConciliationUnit,
  getStoredConciliationUnitForVinculos,
  setStoredConciliationUnit,
} from '@/lib/reconcile-storage'

const UNITS: readonly ConciliationUnit[] = ['PEDERTRACTOR', 'TRACTOR'] as const
const RECORDS_PAGE_SIZE = 50

function statusBadge(status: string) {
  if (status === 'CLOSED') {
    return (
      <Badge variant="secondary" className="border-muted-foreground/30">
        Encerrada
      </Badge>
    )
  }
  return (
    <Badge
      variant="secondary"
      className="border-emerald-600/30 bg-emerald-600/15 text-emerald-800 dark:text-emerald-200"
    >
      Aberta
    </Badge>
  )
}

function runPeriod(r: ReconciliationRunListItem): string {
  if (r.referenceStartDate && r.referenceEndDate) {
    return `${formatDatePt(r.referenceStartDate)} – ${formatDatePt(r.referenceEndDate)}`
  }
  if (r.referenceStartDate) return `desde ${formatDatePt(r.referenceStartDate)}`
  if (r.referenceEndDate) return `até ${formatDatePt(r.referenceEndDate)}`
  return '—'
}

function CompanyUnitPicker({
  value,
  onSelect,
}: {
  value: ConciliationUnit
  onSelect: (u: ConciliationUnit) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label>Empresa</Label>
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

function RecordsView({ run }: { run: ReconciliationRunListItem }) {
  const [recordType, setRecordType] = useState<RunRecordType>('bank')
  const [page, setPage] = useState(1)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: runRecordsQk(run.id, recordType, page, RECORDS_PAGE_SIZE),
    queryFn: ({ signal }) =>
      listRunRecords(
        run.id,
        { type: recordType, page, pageSize: RECORDS_PAGE_SIZE },
        requestInitWithTimeout(signal, 45_000),
      ),
    placeholderData: (prev) => prev,
  })

  function changeType(t: RunRecordType) {
    if (t === recordType) return
    setRecordType(t)
    setPage(1)
  }

  const total = data?.total ?? 0
  const totalPages = total > 0 ? Math.ceil(total / RECORDS_PAGE_SIZE) : 0
  const rangeStart = total === 0 ? 0 : (page - 1) * RECORDS_PAGE_SIZE + 1
  const rangeEnd = Math.min(page * RECORDS_PAGE_SIZE, total)

  const records = data?.records ?? []
  const showingType = data?.type ?? recordType

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={recordType === 'bank' ? 'default' : 'outline'}
          onClick={() => changeType('bank')}
        >
          Banco ({run.counts.bank.toLocaleString('pt-BR')})
        </Button>
        <Button
          type="button"
          size="sm"
          variant={recordType === 'internal' ? 'default' : 'outline'}
          onClick={() => changeType('internal')}
        >
          Interno ({run.counts.internal.toLocaleString('pt-BR')})
        </Button>
        {isFetching ? (
          <span className="text-muted-foreground text-xs">Atualizando…</span>
        ) : null}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {showingType === 'bank' ? (
              <TableRow>
                <TableHead className="w-[8%]">Linha</TableHead>
                <TableHead className="w-[14%]">Vencimento</TableHead>
                <TableHead className="w-[30%]">Beneficiário</TableHead>
                <TableHead className="w-[22%]">Pagador</TableHead>
                <TableHead className="w-[14%]">Nosso número</TableHead>
                <TableHead className="w-[12%] text-right">Valor</TableHead>
              </TableRow>
            ) : (
              <TableRow>
                <TableHead className="w-[7%]">Linha</TableHead>
                <TableHead className="w-[13%]">Vencimento</TableHead>
                <TableHead className="w-[13%]">Emissão</TableHead>
                <TableHead className="w-[30%]">Fornecedor</TableHead>
                <TableHead className="w-[12%]">Nota</TableHead>
                <TableHead className="w-[8%]">Parc.</TableHead>
                <TableHead className="w-[10%] text-right">Valor</TableHead>
                <TableHead className="w-[12%] text-right">Pago</TableHead>
              </TableRow>
            )}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={showingType === 'bank' ? 6 : 8}
                  className="text-muted-foreground p-6 text-center text-sm"
                >
                  Carregando lançamentos…
                </TableCell>
              </TableRow>
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={showingType === 'bank' ? 6 : 8}
                  className="text-muted-foreground p-6 text-center text-sm"
                >
                  Nenhum lançamento {showingType === 'bank' ? 'do banco' : 'do interno'} nesta
                  conciliação.
                </TableCell>
              </TableRow>
            ) : showingType === 'bank' ? (
              (records as BankRunRecord[]).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {r.rowNumber ?? '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
                    {formatDatePt(r.dueDate)}
                  </TableCell>
                  <TableCell className="max-w-0 truncate" title={r.beneficiaryNameRaw}>
                    {r.beneficiaryNameRaw}
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground max-w-0 truncate"
                    title={r.payerNameRaw ?? undefined}
                  >
                    {r.payerNameRaw ?? '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.nossoNumero ?? '—'}</TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {formatBrlAmount(r.amount)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              (records as InternalRunRecord[]).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {r.rowNumber ?? '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
                    {formatDatePt(r.dueDate)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
                    {formatDatePt(r.issueDate)}
                  </TableCell>
                  <TableCell className="max-w-0 truncate" title={r.supplierNameRaw}>
                    {r.supplierNameRaw}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.invoiceNumber ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {r.installment ?? '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {formatBrlAmount(r.amount)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-sm tabular-nums">
                    {formatBrlAmount(r.amountPaid)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 ? (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-muted-foreground text-center text-xs sm:text-left">
            {rangeStart}–{rangeEnd} de {total.toLocaleString('pt-BR')}
          </p>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 pl-2"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  aria-label="Página anterior"
                >
                  <ChevronLeft className="size-4" />
                  <span className="hidden sm:inline">Anterior</span>
                </Button>
              </PaginationItem>
              <PaginationItem>
                <span className="text-muted-foreground flex h-8 min-w-16 items-center justify-center px-2 text-xs">
                  {page} / {totalPages}
                </span>
              </PaginationItem>
              <PaginationItem>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 pr-2"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
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
  )
}

export function ConciliacoesPage() {
  const queryClient = useQueryClient()
  const [unit, setUnit] = useState<ConciliationUnit>(() =>
    getStoredConciliationUnitForVinculos(),
  )
  const [selectedRun, setSelectedRun] = useState<ReconciliationRunListItem | null>(null)
  const [runToDelete, setRunToDelete] = useState<ReconciliationRunListItem | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: reconciliationRunsListQk(unit),
    queryFn: ({ signal }) =>
      listReconciliationRuns({ unit }, requestInitWithTimeout(signal, 45_000)),
  })

  const runs = data?.runs ?? []

  const deleteMutation = useMutation({
    mutationFn: (runId: string) => deleteReconciliationRun(runId),
    onSuccess: () => {
      setRunToDelete(null)
      void queryClient.invalidateQueries({
        queryKey: reconciliationRunsListQk(unit),
      })
    },
  })

  function handleUnitChange(u: ConciliationUnit) {
    setUnit(u)
    setStoredConciliationUnit(u)
    setSelectedRun(null)
  }

  function isEmpty(r: ReconciliationRunListItem): boolean {
    return r.counts.bank === 0 && r.counts.internal === 0
  }

  return (
    <div className="max-w-7xl p-4 md:p-6 lg:mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Conciliações</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Veja as conciliações já criadas e o que foi importado em cada uma (lançamentos do banco
          e do interno).
        </p>
      </div>

      {selectedRun ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 pl-1.5"
                  onClick={() => setSelectedRun(null)}
                >
                  <ArrowLeft className="size-4" />
                  Voltar
                </Button>
                <p className="text-base font-medium">
                  {selectedRun.title?.trim() || 'Conciliação'}
                </p>
                {statusBadge(selectedRun.status)}
              </div>
              <p className="text-muted-foreground text-xs">
                Empresa {selectedRun.unit === 'PEDERTRACTOR' ? 'Pedertractor' : 'Tractor'} · Criada
                em {formatDateTimePt(selectedRun.createdAt)} · Período {runPeriod(selectedRun)}
              </p>
              <p className="text-muted-foreground text-xs">
                {selectedRun.counts.bank.toLocaleString('pt-BR')} lançamentos banco ·{' '}
                {selectedRun.counts.internal.toLocaleString('pt-BR')} interno ·{' '}
                {selectedRun.counts.suggestions.toLocaleString('pt-BR')} sugestões
              </p>
            </div>
          </div>
          <Card>
            <CardContent className="pt-6">
              <RecordsView run={selectedRun} />
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-6">
          <CompanyUnitPicker value={unit} onSelect={handleUnitChange} />
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                Conciliações de {unit === 'PEDERTRACTOR' ? 'Pedertractor' : 'Tractor'}
              </CardTitle>
              <span className="text-muted-foreground text-xs">
                {isLoading
                  ? 'Carregando…'
                  : `${runs.length.toLocaleString('pt-BR')} ${runs.length === 1 ? 'conciliação' : 'conciliações'}`}
              </span>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-muted-foreground py-6 text-center text-sm">Carregando…</p>
              ) : runs.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  Nenhuma conciliação para esta empresa ainda.
                </p>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[28%]">Título</TableHead>
                        <TableHead className="w-[12%]">Status</TableHead>
                        <TableHead className="w-[16%] whitespace-nowrap">Criada em</TableHead>
                        <TableHead className="w-[10%] text-right">Banco</TableHead>
                        <TableHead className="w-[10%] text-right">Interno</TableHead>
                        <TableHead className="w-[12%] text-right">Sugestões</TableHead>
                        <TableHead className="w-[12%] text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runs.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell
                            className="max-w-0 truncate font-medium"
                            title={r.title ?? undefined}
                          >
                            {r.title?.trim() || 'Conciliação'}
                          </TableCell>
                          <TableCell>{statusBadge(r.status)}</TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                            {formatDateTimePt(r.createdAt)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.counts.bank.toLocaleString('pt-BR')}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.counts.internal.toLocaleString('pt-BR')}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.counts.suggestions.toLocaleString('pt-BR')}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="gap-1.5"
                                onClick={() => setSelectedRun(r)}
                              >
                                <Eye className="size-4" />
                                Ver
                              </Button>
                              {isEmpty(r) ? (
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="ghost"
                                  className="text-muted-foreground hover:text-destructive"
                                  aria-label="Excluir conciliação"
                                  onClick={() => setRunToDelete(r)}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger render={<span className="inline-flex" />}>
                                    <Button
                                      type="button"
                                      size="icon-sm"
                                      variant="ghost"
                                      className="text-muted-foreground"
                                      aria-label="Excluir conciliação"
                                      disabled
                                    >
                                      <Trash2 className="size-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[16rem] text-xs">
                                    Só é possível excluir conciliações vazias. Esta tem lançamentos —
                                    use Encerrar para arquivar.
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <Building2 className="size-3.5" />
            Dica: a triagem (aprovar/pagar) fica na tela <Database className="size-3.5" />{' '}
            Conciliação.
          </p>
        </div>
      )}

      <Dialog
        open={runToDelete != null}
        onOpenChange={(open) => {
          if (!open) {
            setRunToDelete(null)
            deleteMutation.reset()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir conciliação?</DialogTitle>
            <DialogDescription>
              A conciliação{' '}
              <span className="text-foreground font-medium">
                {runToDelete?.title?.trim() || 'Conciliação'}
              </span>{' '}
              está vazia (sem lançamentos) e será excluída definitivamente. Esta ação não pode ser
              desfeita.
            </DialogDescription>
          </DialogHeader>
          {deleteMutation.isError ? (
            <p className="text-destructive text-sm">
              {deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : 'Não foi possível excluir.'}
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRunToDelete(null)}
              disabled={deleteMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (runToDelete) deleteMutation.mutate(runToDelete.id)
              }}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                'Excluir'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
