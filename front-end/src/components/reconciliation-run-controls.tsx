import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  closeReconciliationRun,
  createReconciliationRun,
  getMeUserRequest,
  getReconciliationRun,
  getReconciliationRunClosePreview,
  reconciliationRunClosePreviewQk,
  reconciliationRunDetailQk,
  reopenReconciliationRun,
  type ReconciliationRunDto,
} from '@/lib/api'
import {
  importReconciliationRunQueryKey,
  vinculosReconciliationRunQueryKey,
} from '@/lib/reconcile-run-session'
import {
  setStoredReconciliationRunId,
  type ConciliationUnit,
} from '@/lib/reconcile-storage'

function defaultNewRunTitle(): string {
  const label = format(new Date(), 'dd/MM/yyyy', { locale: ptBR })
  return `Conciliação ${label}`
}

function formatRunPeriod(run: ReconciliationRunDto): string | null {
  if (!run.referenceStartDate && !run.referenceEndDate) return null
  const fmt = (iso: string) =>
    format(new Date(iso), 'dd/MM/yyyy', { locale: ptBR })
  if (run.referenceStartDate && run.referenceEndDate) {
    return `${fmt(run.referenceStartDate)} – ${fmt(run.referenceEndDate)}`
  }
  if (run.referenceStartDate) return `desde ${fmt(run.referenceStartDate)}`
  if (run.referenceEndDate) return `até ${fmt(run.referenceEndDate)}`
  return null
}

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

type ReconciliationRunControlsProps = {
  runId: string
  unit: ConciliationUnit
  onRunChanged?: (newRunId: string) => void
  context: 'import' | 'vinculos'
}

export function ReconciliationRunControls({
  runId,
  unit,
  onRunChanged,
  context,
}: ReconciliationRunControlsProps) {
  const queryClient = useQueryClient()
  const [closeOpen, setCloseOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [newTitle, setNewTitle] = useState(defaultNewRunTitle)

  const { data: runData, isLoading: runLoading } = useQuery({
    queryKey: reconciliationRunDetailQk(runId),
    queryFn: () => getReconciliationRun(runId),
  })

  const { data: meData } = useQuery({
    queryKey: ['users', 'me'],
    queryFn: getMeUserRequest,
    staleTime: 5 * 60 * 1000,
  })

  const { data: previewData, isLoading: previewLoading } = useQuery({
    queryKey: reconciliationRunClosePreviewQk(runId),
    queryFn: () => getReconciliationRunClosePreview(runId),
    // Busca ao abrir o diálogo e também com a conciliação aberta, para saber se está vazia.
    enabled: closeOpen || (runData?.run != null && runData.run.status !== 'CLOSED'),
  })

  const run = runData?.run
  const isClosed = run?.status === 'CLOSED'
  const isAdmin = meData?.user.role === 'ADMIN'
  // Conciliação sem nada importado: não há o que encerrar.
  const isEmptyRun =
    previewData?.summary != null &&
    previewData.summary.bankRecordCount === 0 &&
    previewData.summary.internalRecordCount === 0

  const invalidateRunQueries = (id: string) => {
    void queryClient.invalidateQueries({ queryKey: reconciliationRunDetailQk(id) })
    void queryClient.invalidateQueries({ queryKey: importReconciliationRunQueryKey(unit) })
    void queryClient.invalidateQueries({ queryKey: vinculosReconciliationRunQueryKey(unit) })
  }

  const closeMutation = useMutation({
    mutationFn: () => closeReconciliationRun(runId),
    onSuccess: () => {
      setCloseOpen(false)
      invalidateRunQueries(runId)
    },
  })

  const newMutation = useMutation({
    mutationFn: async () => {
      // Na tela de importar, criar um novo ciclo encerra e arquiva o atual (se aberto),
      // para não deixar duas conciliações abertas da mesma empresa.
      if (context === 'import' && run?.status !== 'CLOSED') {
        await closeReconciliationRun(runId)
      }
      return createReconciliationRun({
        unit,
        title: newTitle.trim() || defaultNewRunTitle(),
      })
    },
    onSuccess: ({ run: created }) => {
      setStoredReconciliationRunId(created.id)
      setNewOpen(false)
      setNewTitle(defaultNewRunTitle())
      invalidateRunQueries(created.id)
      queryClient.setQueryData(importReconciliationRunQueryKey(unit), created.id)
      queryClient.setQueryData(vinculosReconciliationRunQueryKey(unit), created.id)
      onRunChanged?.(created.id)
    },
  })

  const reopenMutation = useMutation({
    mutationFn: () => reopenReconciliationRun(runId),
    onSuccess: () => {
      invalidateRunQueries(runId)
    },
  })

  if (runLoading || !run) {
    return (
      <p className="text-muted-foreground text-sm">Carregando conciliação ativa…</p>
    )
  }

  const period = formatRunPeriod(run)
  const title = run.title?.trim() || 'Conciliação'

  return (
    <div className="bg-muted/30 space-y-3 rounded-lg border p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{title}</p>
            {statusBadge(run.status)}
          </div>
          <p className="text-muted-foreground text-xs">
            {period ? `${period} · ` : null}
            Empresa {unit === 'PEDERTRACTOR' ? 'Pedertractor' : 'Tractor'}
          </p>
          {isClosed ? (
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Conciliação encerrada — não é possível importar planilhas neste ciclo. Inicie uma
              nova conciliação para o próximo período.
            </p>
          ) : isEmptyRun ? (
            <p className="text-muted-foreground text-xs">
              {context === 'import'
                ? 'Conciliação ativa e ainda vazia. Importe as planilhas abaixo — elas ficam guardadas aqui. Você não precisa criar nada para começar.'
                : 'Conciliação ativa e ainda vazia.'}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              {context === 'import'
                ? 'Conciliação ativa. Tudo que você importar fica guardado aqui. Para começar outro período, use “Nova conciliação” — a atual será encerrada e arquivada.'
                : 'Conciliação ativa. Use “Nova conciliação” para começar outro período e “Encerrar conciliação” quando terminar este.'}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {isClosed && isAdmin && context === 'vinculos' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={reopenMutation.isPending}
              onClick={() => reopenMutation.mutate()}
            >
              {reopenMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                'Reabrir'
              )}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setNewTitle(defaultNewRunTitle())
              setNewOpen(true)
            }}
          >
            Nova conciliação
          </Button>
          {context === 'vinculos' && !isClosed ? (
            isEmptyRun ? (
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <Button type="button" size="sm" variant="secondary" disabled>
                    Encerrar conciliação
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[16rem] text-xs">
                  Importe ao menos uma planilha para poder encerrar esta conciliação.
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setCloseOpen(true)}
              >
                Encerrar conciliação
              </Button>
            )
          ) : null}
        </div>
      </div>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Encerrar conciliação?</DialogTitle>
            <DialogDescription>
              Os dados e a triagem permanecem disponíveis. Novos uploads neste ciclo serão
              bloqueados.
            </DialogDescription>
          </DialogHeader>
          {previewLoading ? (
            <p className="text-muted-foreground text-sm">Carregando resumo…</p>
          ) : previewData?.summary ? (
            <ul className="text-muted-foreground list-inside list-disc space-y-1 text-sm">
              <li>
                {previewData.summary.openSuggestionsCount.toLocaleString('pt-BR')} sugestões em
                aberto na triagem
              </li>
              <li>
                {previewData.summary.bankRecordCount.toLocaleString('pt-BR')} lançamentos banco ·{' '}
                {previewData.summary.internalRecordCount.toLocaleString('pt-BR')} interno
              </li>
              {previewData.summary.warnings.map((w) => (
                <li key={w} className="text-amber-800 dark:text-amber-200">
                  {w}
                </li>
              ))}
            </ul>
          ) : null}
          {closeMutation.isError ? (
            <p className="text-destructive text-sm">
              {closeMutation.error instanceof Error
                ? closeMutation.error.message
                : 'Não foi possível encerrar.'}
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setCloseOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={closeMutation.isPending}
              onClick={() => closeMutation.mutate()}
            >
              {closeMutation.isPending ? 'Encerrando…' : 'Encerrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova conciliação</DialogTitle>
            <DialogDescription>
              {context === 'import' && !isClosed ? (
                isEmptyRun ? (
                  <>
                    Cria um ciclo novo e vazio para{' '}
                    {unit === 'PEDERTRACTOR' ? 'Pedertractor' : 'Tractor'}. A conciliação atual
                    (vazia) será encerrada e arquivada.
                  </>
                ) : (
                  <>
                    A conciliação atual será <strong>encerrada e arquivada</strong>
                    {previewData?.summary
                      ? ` (${previewData.summary.bankRecordCount.toLocaleString('pt-BR')} lançamentos banco · ${previewData.summary.internalRecordCount.toLocaleString('pt-BR')} interno)`
                      : ''}
                    , e um novo ciclo vazio começará para{' '}
                    {unit === 'PEDERTRACTOR' ? 'Pedertractor' : 'Tractor'}. Os dados antigos
                    continuam disponíveis para consulta em Conciliação.
                  </>
                )
              ) : (
                <>
                  Cria um ciclo novo e aberto para{' '}
                  {unit === 'PEDERTRACTOR' ? 'Pedertractor' : 'Tractor'}. A conciliação anterior
                  permanece no histórico.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-run-title">Título</Label>
            <Input
              id="new-run-title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              maxLength={200}
            />
          </div>
          {newMutation.isError ? (
            <p className="text-destructive text-sm">
              {newMutation.error instanceof Error
                ? newMutation.error.message
                : 'Não foi possível criar.'}
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setNewOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={newMutation.isPending}
              onClick={() => newMutation.mutate()}
            >
              {newMutation.isPending
                ? 'Criando…'
                : context === 'import' && !isClosed && !isEmptyRun
                  ? 'Encerrar e criar'
                  : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
