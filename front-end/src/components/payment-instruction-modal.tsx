import type { ReactNode } from 'react'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Loader2 } from 'lucide-react'
import { AccountPaidConfirmDialog } from '@/components/account-paid-confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  getPaymentVinculoInstruction,
  markSuggestionPaid,
  type PaymentInstructionResponse,
} from '@/lib/api'
import { cn } from '@/lib/utils'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  runId: string | null
  suggestionId: string | null
}

function formatBrl(raw: string): string {
  const n = Number.parseFloat(raw)
  if (Number.isNaN(n)) {
    return raw
  }
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDatePtBr(iso: string | null): string {
  if (!iso) {
    return '—'
  }
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    }
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

function formatDateTimePtBr(iso: string | null | undefined): string {
  if (!iso) {
    return '—'
  }
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

function ReadField({
  label,
  children,
  valueClassName,
}: {
  label: string
  children: ReactNode
  valueClassName?: string
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="text-muted-foreground text-sm font-medium leading-none">
        {label}
      </div>
      <div
        className={cn(
          'text-foreground text-sm font-medium leading-snug wrap-anywhere',
          valueClassName,
        )}
      >
        {children}
      </div>
    </div>
  )
}

function VinculoReadBlock({ d }: { d: PaymentInstructionResponse }) {
  const v = d.vinculo
  if (!v) {
    return (
      <p className="text-muted-foreground text-sm">
        Ainda não há registro de fornecedor em{' '}
        <Link
          to="/pix-ted"
          className="text-primary font-medium underline underline-offset-2"
        >
          PIX & TED
        </Link>
        . Cadastre para ver banco, chave ou CNPJ neste painel.
      </p>
    )
  }
  if (d.kind === 'PIX') {
    return (
      <div className="mt-1 space-y-3">
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_7.5rem]">
          <ReadField label="Nome / razão">
            {v.registroNome || v.displayName || '—'}
          </ReadField>
          <ReadField label="Código" valueClassName="font-mono">
            {v.userCode?.trim() ? v.userCode : '—'}
          </ReadField>
        </div>
        <ReadField label="Chave PIX">
          {v.pixChave?.trim() ? v.pixChave : '—'}
        </ReadField>
      </div>
    )
  }
  return (
    <div className="mt-1 space-y-3">
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_7.5rem]">
        <ReadField label="Nome / razão">
          {v.registroNome || v.displayName || '—'}
        </ReadField>
        <ReadField label="Código" valueClassName="font-mono">
          {v.userCode?.trim() ? v.userCode : '—'}
        </ReadField>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-start">
        <ReadField label="Banco">
          {v.tedBanco?.trim() ? v.tedBanco : '—'}
        </ReadField>
        <ReadField label="Agência" valueClassName="font-mono">
          {v.tedAgencia?.trim() ? v.tedAgencia : '—'}
        </ReadField>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-start">
        <ReadField label="Conta corrente (C/C)" valueClassName="font-mono">
          {v.tedConta?.trim() ? v.tedConta : '—'}
        </ReadField>
        <ReadField label="CNPJ" valueClassName="font-mono">
          {v.tedCnpj?.trim() ? v.tedCnpj : '—'}
        </ReadField>
      </div>
    </div>
  )
}

export function PaymentInstructionModal({
  open,
  onOpenChange,
  runId,
  suggestionId,
}: Props) {
  const queryClient = useQueryClient()
  const [paidDialogOpen, setPaidDialogOpen] = useState(false)
  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      'payment-instruction',
      runId,
      suggestionId,
    ] as const,
    queryFn: () =>
      getPaymentVinculoInstruction(runId!, suggestionId!),
    enabled: open && runId != null && suggestionId != null,
  })

  const markPaidMutation = useMutation({
    mutationFn: () => markSuggestionPaid(runId!, suggestionId!),
    onSuccess: () => {
      setPaidDialogOpen(false)
      if (runId) {
        void queryClient.invalidateQueries({ queryKey: ['reconciliation-suggestions'] })
      }
      void queryClient.invalidateQueries({
        queryKey: ['payment-instruction', runId, suggestionId],
      })
    },
  })

  const title = !data
    ? 'Instrução de pagamento'
    : data.kind === 'TED'
      ? 'Instrução de pagamento TED'
      : 'Instrução de pagamento PIX'

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md gap-0 p-0 sm:max-w-lg"
        showCloseButton
      >
        <div className="p-5 sm:p-6">
          <DialogHeader className="p-0">
            <DialogTitle className="text-left">{title}</DialogTitle>
          </DialogHeader>
          {isLoading ? (
            <div className="text-muted-foreground mt-4 flex items-center gap-2 py-2 text-sm">
              <Loader2 className="size-4 shrink-0 animate-spin" />
              Carregando…
            </div>
          ) : isError ? (
            <p className="text-destructive mt-4 text-sm" role="alert">
              {error instanceof Error
                ? error.message
                : 'Não foi possível carregar a instrução de pagamento.'}
            </p>
          ) : data ? (
            <div className="mt-4 space-y-4">
              {!data.hasRegistryDetails && (
                <p
                  className={cn(
                    'rounded-md border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs',
                    'text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40',
                    'dark:text-amber-100',
                  )}
                  role="status"
                >
                  Dados bancários incompletos. Complete o cadastro em{' '}
                  <Link
                    to="/pix-ted"
                    className="text-primary font-medium underline underline-offset-2"
                  >
                    PIX & TED
                  </Link>
                  : para {data.kind}, preencha os campos obrigatórios nessa tela; os
                  ícones na conciliação ficarão ativos após o cadastro.
                </p>
              )}
              <div className="space-y-1.5 text-sm">
                <p>
                  <span className="text-muted-foreground">Vencimento: </span>
                  <span className="font-medium">
                    {formatDatePtBr(data.dueDate)}
                  </span>
                </p>
                <p>
                  <span className="text-muted-foreground">Valor a liquidar: </span>
                  <span className="text-foreground text-base font-semibold tabular-nums">
                    {formatBrl(data.amount)}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                  {data.kind === 'PIX' ? 'Dados do PIX' : 'Dados do TED'}
                </p>
                <VinculoReadBlock d={data} />
              </div>
            </div>
          ) : null}
          {data != null && data.paidAt ? (
            <p
              className="text-muted-foreground border-border/60 bg-muted/40 mt-4 rounded-md border px-3 py-2 text-sm"
              role="status"
            >
              Conta marcada como paga em {formatDateTimePtBr(data.paidAt)}.
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            {data != null && !data.paidAt && !isLoading && !isError ? (
              <Button
                type="button"
                onClick={() => setPaidDialogOpen(true)}
                disabled={markPaidMutation.isPending}
              >
                Marcar como pago
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Fechar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <AccountPaidConfirmDialog
      open={paidDialogOpen}
      onOpenChange={setPaidDialogOpen}
      isPending={markPaidMutation.isPending}
      onConfirmYes={() => {
        markPaidMutation.mutate()
      }}
    />
    </>
  )
}
