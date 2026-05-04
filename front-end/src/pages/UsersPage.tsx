import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, Lock, LockOpen, UserPlus, Users } from 'lucide-react'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  activateUserRequest,
  deactivateUserRequest,
  listUsersRequest,
  registerUserRequest,
  resetFirstLoginRequest,
  type PublicUser,
} from '@/lib/api'
import { cn } from '@/lib/utils'

type ActiveFilter = 'all' | 'active' | 'inactive'

const USERS_QK = (f: ActiveFilter) => ['users', f] as const

const UNITS = [
  { value: 'PEDERTRACTOR', label: 'Pedertractor' },
  { value: 'TRACTOR', label: 'Tractor' },
] as const

const ROLES = [
  { value: 'FINANCIAL', label: 'Financeiro' },
  { value: 'ADMIN', label: 'Administrador' },
] as const

function readStoredUserId(): string | null {
  try {
    const r = localStorage.getItem('reconcile_user')
    if (!r) return null
    const u = JSON.parse(r) as { id?: string }
    return typeof u.id === 'string' ? u.id : null
  } catch {
    return null
  }
}

function unitLabel(u: string): string {
  const x = UNITS.find((e) => e.value === u)
  return x?.label ?? u
}

function roleLabel(r: string): string {
  const x = ROLES.find((e) => e.value === r)
  return x?.label ?? r
}

export function UsersPage() {
  const queryClient = useQueryClient()
  const myId = useMemo(() => readStoredUserId(), [])
  const [filter, setFilter] = useState<ActiveFilter>('active')
  const [createOpen, setCreateOpen] = useState(false)
  const [newCard, setNewCard] = useState('')
  const [newUnit, setNewUnit] = useState<'PEDERTRACTOR' | 'TRACTOR' | ''>('')
  const [newRole, setNewRole] = useState<'FINANCIAL' | 'ADMIN' | ''>('')
  const [confirmDeactivate, setConfirmDeactivate] = useState<PublicUser | null>(null)
  const [confirmActivate, setConfirmActivate] = useState<PublicUser | null>(null)
  const [confirmReset, setConfirmReset] = useState<PublicUser | null>(null)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: USERS_QK(filter),
    queryFn: () =>
      filter === 'all'
        ? listUsersRequest()
        : listUsersRequest({ active: filter === 'active' }),
  })

  const users = data?.users ?? []

  const registerMut = useMutation({
    mutationFn: registerUserRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setCreateOpen(false)
      setNewCard('')
      setNewUnit('')
      setNewRole('')
    },
  })

  const deactivateMut = useMutation({
    mutationFn: deactivateUserRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setConfirmDeactivate(null)
    },
  })

  const activateMut = useMutation({
    mutationFn: activateUserRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setConfirmActivate(null)
    },
  })

  const resetMut = useMutation({
    mutationFn: resetFirstLoginRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setConfirmReset(null)
    },
  })

  const canSubmitCreate =
    /^\d{1,4}$/.test(newCard.trim()) &&
    (newUnit === 'PEDERTRACTOR' || newUnit === 'TRACTOR') &&
    (newRole === 'FINANCIAL' || newRole === 'ADMIN')

  return (
    <>
      <Dialog
        open={confirmDeactivate != null}
        onOpenChange={(o) => {
          if (!o) setConfirmDeactivate(null)
        }}
      >
        <DialogContent showCloseButton className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Desativar usuário</DialogTitle>
            <DialogDescription>
              {confirmDeactivate ? (
                <>
                  <span className="text-foreground font-medium">
                    {confirmDeactivate.name}
                  </span>{' '}
                  não poderá mais entrar no sistema.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDeactivate(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deactivateMut.isPending}
              onClick={() => {
                if (confirmDeactivate) {
                  deactivateMut.mutate(confirmDeactivate.id)
                }
              }}
            >
              {deactivateMut.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                'Desativar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmActivate != null}
        onOpenChange={(o) => {
          if (!o) setConfirmActivate(null)
        }}
      >
        <DialogContent showCloseButton className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ativar usuário</DialogTitle>
            <DialogDescription>
              {confirmActivate ? (
                <>
                  <span className="text-foreground font-medium">{confirmActivate.name}</span>{' '}
                  voltará a poder entrar no sistema com a senha atual.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setConfirmActivate(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={activateMut.isPending}
              onClick={() => {
                if (confirmActivate) {
                  activateMut.mutate(confirmActivate.id)
                }
              }}
            >
              {activateMut.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                'Ativar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmReset != null}
        onOpenChange={(o) => {
          if (!o) setConfirmReset(null)
        }}
      >
        <DialogContent showCloseButton className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resetar primeiro acesso</DialogTitle>
            <DialogDescription className="space-y-2 text-sm">
              <span className="block">
                A senha volta ao <strong>número do cartão</strong> e o usuário deverá
                definir uma nova senha no próximo login (fluxo de primeiro acesso).
              </span>
              {confirmReset ? (
                <span className="text-foreground mt-2 block font-medium">
                  {confirmReset.name}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setConfirmReset(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={resetMut.isPending}
              onClick={() => {
                if (confirmReset) {
                  resetMut.mutate(confirmReset.id)
                }
              }}
            >
              {resetMut.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                'Confirmar reset'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent
          showCloseButton
          className="gap-0 overflow-hidden rounded-xl p-0 shadow-lg sm:max-w-[440px]"
        >
          <DialogHeader className="space-y-2 px-6 pt-6 pb-0 text-left">
            <DialogTitle className="text-foreground pr-8 text-lg font-semibold leading-tight tracking-tight">
              Novo usuário
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm leading-snug">
              A senha inicial é o número do cartão.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-5 px-6 py-6">
            <div className="flex flex-col gap-2">
              <Label
                htmlFor="new-card"
                className="text-foreground text-sm font-medium"
              >
                Cartão (até 4 dígitos)
              </Label>
              <Input
                id="new-card"
                inputMode="numeric"
                maxLength={4}
                value={newCard}
                onChange={(e) => setNewCard(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Ex.: 1234"
                className="border-border/80 bg-background h-10 rounded-lg px-3 text-sm shadow-none md:text-sm"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-unit" className="text-foreground text-sm font-medium">
                Unidade
              </Label>
              <Select
                value={newUnit || undefined}
                onValueChange={(v) =>
                  setNewUnit(v as 'PEDERTRACTOR' | 'TRACTOR')
                }
              >
                <SelectTrigger
                  id="new-unit"
                  className="border-border/80 bg-background h-10 w-full rounded-lg px-3 shadow-none data-placeholder:text-muted-foreground"
                >
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u.value} value={u.value}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-role" className="text-foreground text-sm font-medium">
                Perfil
              </Label>
              <Select
                value={newRole || undefined}
                onValueChange={(v) => setNewRole(v as 'FINANCIAL' | 'ADMIN')}
              >
                <SelectTrigger
                  id="new-role"
                  className="border-border/80 bg-background h-10 w-full rounded-lg px-3 shadow-none data-placeholder:text-muted-foreground"
                >
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {registerMut.isError ? (
              <p className="text-destructive text-sm">
                {registerMut.error instanceof Error
                  ? registerMut.error.message
                  : 'Erro ao cadastrar'}
              </p>
            ) : null}
          </div>
          <DialogFooter className="gap-0 px-6 pt-0 pb-6 sm:justify-end">
            <Button
              type="button"
              size="lg"
              disabled={!canSubmitCreate || registerMut.isPending}
              className="bg-muted-foreground hover:bg-muted-foreground/90 h-10 min-w-34 rounded-lg border-0 px-8 text-white shadow-none"
              onClick={() => {
                if (!canSubmitCreate) return
                registerMut.mutate({
                  cardNumber: newCard.trim(),
                  unit: newUnit,
                  role: newRole,
                })
              }}
            >
              {registerMut.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                'Cadastrar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="bg-muted/20 flex min-h-0 flex-1 flex-col gap-4 p-3 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-foreground flex items-center gap-2 text-lg font-semibold tracking-tight md:text-xl">
              <Users className="size-5 shrink-0 opacity-80" />
              Usuários
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Cadastro, desativação e reset de senha (primeiro acesso).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={filter}
              onValueChange={(v) => setFilter(v as ActiveFilter)}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Somente ativos</SelectItem>
                <SelectItem value="inactive">Somente inativos</SelectItem>
                <SelectItem value="all">Todos</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <UserPlus className="size-4" />
              Novo usuário
            </Button>
          </div>
        </div>

        <Card className="flex min-h-0 flex-1 flex-col border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Lista</CardTitle>
            <CardDescription>
              Perfis financeiro e administrador; mesma regra de acesso da API.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 pt-0">
            {isLoading ? (
              <div className="text-muted-foreground flex items-center gap-2 py-12 text-sm">
                <Loader2 className="size-4 animate-spin" />
                Carregando…
              </div>
            ) : isError ? (
              <p className="text-destructive py-8 text-sm">
                {error instanceof Error ? error.message : 'Falha ao listar usuários'}
              </p>
            ) : (
              <div className="max-h-[min(32rem,60vh)] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Cartão</TableHead>
                      <TableHead>Unidade</TableHead>
                      <TableHead>Perfil</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>1º acesso</TableHead>
                      <TableHead className="text-right min-w-[16rem] w-[16rem]">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-muted-foreground py-10 text-center">
                          Nenhum usuário neste filtro.
                        </TableCell>
                      </TableRow>
                    ) : (
                      users.map((u) => {
                        const isSelf = myId != null && u.id === myId
                        return (
                          <TableRow key={u.id}>
                            <TableCell className="font-medium">{u.name}</TableCell>
                            <TableCell className="font-mono text-sm">{u.cardNumber}</TableCell>
                            <TableCell>{unitLabel(u.unit)}</TableCell>
                            <TableCell>{roleLabel(u.role)}</TableCell>
                            <TableCell>
                              <Badge variant={u.active ? 'default' : 'secondary'}>
                                {u.active ? 'Ativo' : 'Inativo'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  u.firstLogin &&
                                    'border-amber-500/50 text-amber-800 dark:text-amber-200',
                                )}
                              >
                                {u.firstLogin ? 'Pendente' : 'Concluído'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-nowrap items-center justify-end gap-2">
                                {isSelf ? (
                                  <span className="text-muted-foreground text-xs px-1 py-1">
                                    Você
                                  </span>
                                ) : (
                                  <>
                                    {u.active ? (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-8 shrink-0 rounded-lg gap-1.5 px-2.5"
                                        onClick={() => setConfirmDeactivate(u)}
                                      >
                                        <LockOpen className="size-3.5 opacity-80" aria-hidden />
                                        Desativar
                                      </Button>
                                    ) : (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-8 shrink-0 rounded-lg gap-1.5 px-2.5"
                                        onClick={() => setConfirmActivate(u)}
                                      >
                                        <Lock className="size-3.5 opacity-80" aria-hidden />
                                        Ativar
                                      </Button>
                                    )}
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="sm"
                                      className="h-8 shrink-0 rounded-lg gap-1.5 px-2.5"
                                      onClick={() => setConfirmReset(u)}
                                    >
                                      <KeyRound className="size-3.5" aria-hidden />
                                      Reset senha
                                    </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
            {(deactivateMut.isError ||
              activateMut.isError ||
              resetMut.isError) && (
              <p className="text-destructive mt-3 text-sm">
                {deactivateMut.error instanceof Error
                  ? deactivateMut.error.message
                  : activateMut.error instanceof Error
                    ? activateMut.error.message
                    : resetMut.error instanceof Error
                      ? resetMut.error.message
                      : 'Erro na operação'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
