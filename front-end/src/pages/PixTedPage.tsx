import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, NotebookPen, Pencil, Wallet } from 'lucide-react'
import { PaymentVinculoEditModal } from '@/components/payment-vinculo-edit-modal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { listPaymentVinculoNames } from '@/lib/api'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 20

function formatDateTimePt(iso: string): string {
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

const paymentVincListQk = (page: number) =>
  ['payment-vinculo-names', page, PAGE_SIZE] as const

function TipoBadge({ kind }: { kind: 'PIX' | 'TED' }) {
  if (kind === 'PIX') {
    return (
      <Badge
        variant="secondary"
        className="font-mono text-[0.65rem] border-teal-200/80 text-teal-800 dark:text-teal-200"
      >
        PIX
      </Badge>
    )
  }
  return (
    <Badge
      variant="secondary"
      className="font-mono text-[0.65rem] border-sky-200/80 text-sky-800 dark:text-sky-200"
    >
      TED
    </Badge>
  )
}

export function PixTedPage() {
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<{
    id: string
    kind: 'PIX' | 'TED'
  } | null>(null)
  const { data, isLoading, isError, error } = useQuery({
    queryKey: paymentVincListQk(page),
    queryFn: () => listPaymentVinculoNames({ page, pageSize: PAGE_SIZE }),
  })

  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 1
  const currentPage = data?.page ?? page
  const start = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const end = total === 0 ? 0 : Math.min(currentPage * PAGE_SIZE, total)

  return (
    <>
      <PaymentVinculoEditModal
        open={editing != null}
        onOpenChange={(o) => {
          if (!o) {
            setEditing(null)
          }
        }}
        vinculoId={editing?.id ?? null}
        kind={editing?.kind ?? 'PIX'}
      />
    <div className="bg-muted/20 flex min-h-0 flex-1 flex-col gap-4 p-3 md:p-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Wallet className="text-muted-foreground size-5 shrink-0" />
          <h1 className="text-foreground text-lg font-semibold tracking-tight md:text-xl">
            PIX & TED
          </h1>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Fornecedores que você vinculou na conciliação (sem par banco) como PIX ou TED.
        </p>
      </div>

      <Card className="border-border/60 min-w-0 flex-1">
        <CardHeader className="space-y-1 pb-2">
          <CardTitle className="text-base">Cadastro</CardTitle>
          <CardDescription>
            {isLoading
              ? 'Carregando…'
              : total > 0
                ? `${total.toLocaleString('pt-BR')} registro(s)`
                : 'Nenhum fornecedor cadastrado ainda.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isError ? (
            <p className="text-destructive text-sm" role="alert">
              {error instanceof Error
                ? error.message
                : 'Não foi possível carregar a lista.'}
            </p>
          ) : isLoading ? (
            <p className="text-muted-foreground text-sm">Carregando…</p>
          ) : (data?.items.length ?? 0) === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nada cadastrado ainda.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="max-w-full overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-20 text-xs">Tipo</TableHead>
                      <TableHead className="min-w-[10rem] text-xs">
                        Nome (exibição)
                      </TableHead>
                      <TableHead className="hidden text-xs sm:table-cell">
                        Nome normalizado
                      </TableHead>
                      <TableHead className="w-44 whitespace-nowrap text-right text-xs">
                        Atualizado em
                      </TableHead>
                      <TableHead className="w-12 text-right text-xs">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data!.items.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="align-middle">
                          <TipoBadge kind={row.kind} />
                        </TableCell>
                        <TableCell className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                          {row.displayName}
                        </TableCell>
                        <TableCell className="text-muted-foreground hidden max-w-sm font-mono text-xs sm:table-cell [overflow-wrap:anywhere]">
                          {row.normalizedName}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right text-xs tabular-nums">
                          {formatDateTimePt(row.updatedAt)}
                        </TableCell>
                        <TableCell className="w-12 p-1 text-right">
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="inline-flex" />
                              }
                            >
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                aria-label={
                                  row.hasDetails
                                    ? 'Editar cadastro de pagamento'
                                    : 'Cadastrar dados de pagamento'
                                }
                                onClick={() => {
                                  setEditing({ id: row.id, kind: row.kind })
                                }}
                              >
                                {row.hasDetails ? (
                                  <Pencil className="size-4" />
                                ) : (
                                  <NotebookPen className="size-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="max-w-[16rem] text-xs">
                              {row.hasDetails
                                ? 'Editar nome, código, chave PIX ou dados bancários do TED.'
                                : 'Cadastre uma vez: nome, código, chave PIX (ou banco, agência, conta e CNPJ para TED).'}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {totalPages > 1 ? (
                <div
                  className={cn(
                    'flex flex-col items-center justify-between gap-3 sm:flex-row',
                  )}
                >
                  <p className="text-muted-foreground text-center text-xs sm:text-left">
                    {start}–{end} de {total}
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
                          disabled={currentPage <= 1}
                          aria-label="Página anterior"
                        >
                          <ChevronLeft className="size-4" />
                          <span className="hidden sm:inline">Anterior</span>
                        </Button>
                      </PaginationItem>
                      <PaginationItem>
                        <span className="text-muted-foreground flex h-8 min-w-20 items-center justify-center px-2 text-xs">
                          {currentPage} / {totalPages}
                        </span>
                      </PaginationItem>
                      <PaginationItem>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 pr-2"
                          onClick={() =>
                            setPage((p) => Math.min(totalPages, p + 1))
                          }
                          disabled={currentPage >= totalPages}
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
          )}
        </CardContent>
      </Card>
    </div>
    </>
  )
}
