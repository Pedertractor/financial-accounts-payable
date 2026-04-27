import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Landmark, Loader2, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { getPaymentVinculoById, putPaymentVinculoById } from '@/lib/api'
import {
  pixVinculoFormSchema,
  tedVinculoFormSchema,
} from '@/lib/payment-vinculo-form'
import { cn } from '@/lib/utils'

const paymentListQk = ['payment-vinculo-names'] as const

type FormModel = {
  userCode: string
  pixChave: string
  tedBanco: string
  tedAgencia: string
  tedConta: string
  tedCnpj: string
}

const emptyForm: FormModel = {
  userCode: '',
  pixChave: '',
  tedBanco: '',
  tedAgencia: '',
  tedConta: '',
  tedCnpj: '',
}

type Props = {
  open: boolean
  onOpenChange: (o: boolean) => void
  vinculoId: string | null
  kind: 'PIX' | 'TED'
  onSaved?: () => void
}

export function PaymentVinculoEditModal(props: Props) {
  return (
    <PaymentVinculoEditModalForm
      key={`${props.vinculoId ?? 'closed'}-${props.kind}`}
      {...props}
    />
  )
}

function PaymentVinculoEditModalForm({
  open,
  onOpenChange,
  vinculoId,
  kind,
  onSaved,
}: Props) {
  const queryClient = useQueryClient()
  const schema = useMemo(
    () => (kind === 'PIX' ? pixVinculoFormSchema : tedVinculoFormSchema),
    [kind],
  )

  const form = useForm<FormModel>({
    resolver: zodResolver(schema) as Resolver<FormModel>,
    defaultValues: emptyForm,
    mode: 'onTouched',
  })

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['payment-vinculo', vinculoId] as const,
    queryFn: () => getPaymentVinculoById(vinculoId!),
    enabled: open && vinculoId != null,
  })

  const v = data?.vinculo

  useEffect(() => {
    if (!v) {
      return
    }
    form.reset({
      userCode: v.userCode ?? '',
      pixChave: v.pixChave ?? '',
      tedBanco: v.tedBanco ?? '',
      tedAgencia: v.tedAgencia ?? '',
      tedConta: v.tedConta ?? '',
      tedCnpj: v.tedCnpj ?? '',
    })
  }, [v, form])

  const save = useMutation({
    mutationFn: (values: FormModel) => {
      const userCode = values.userCode.trim() || null
      return putPaymentVinculoById(vinculoId!, {
        userCode,
        pixChave: kind === 'PIX' ? values.pixChave.trim() || null : null,
        tedBanco: kind === 'TED' ? values.tedBanco.trim() || null : null,
        tedAgencia: kind === 'TED' ? values.tedAgencia.trim() || null : null,
        tedConta: kind === 'TED' ? values.tedConta.trim() || null : null,
        tedCnpj: kind === 'TED' ? values.tedCnpj.trim() || null : null,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: paymentListQk })
      void queryClient.invalidateQueries({
        queryKey: ['reconciliation-suggestions'],
      })
      onOpenChange(false)
      onSaved?.()
    },
    onError: (e) => {
      const msg =
        e instanceof Error
          ? e.message
          : 'Não foi possível salvar. Tente novamente.'
      form.setError('root', { type: 'server', message: msg })
    },
  })

  function onSubmit(values: FormModel) {
    form.clearErrors('root')
    if (!vinculoId) {
      return
    }
    save.mutate(values)
  }

  const loadErr = isError
    ? error instanceof Error
      ? error.message
      : 'Erro ao carregar'
    : null

  const { errors: formErrors } = form.formState
  const saveRootError = formErrors.root

  const razaoDisplay = v
    ? (v.registroNome || v.displayName || '').trim() || '—'
    : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md gap-0 p-0 sm:max-w-lg"
        showCloseButton
      >
        <div className="p-5 sm:p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="contents">
              <DialogHeader className="p-0">
                <DialogTitle className="flex items-center gap-2.5 text-left">
                  {kind === 'PIX' ? (
                    <QrCode
                      className={cn(
                        'size-5 shrink-0',
                        v?.hasDetails
                          ? 'text-teal-600 dark:text-teal-400'
                          : 'text-muted-foreground/60',
                      )}
                      aria-hidden
                    />
                  ) : (
                    <Landmark
                      className={cn(
                        'size-5 shrink-0',
                        v?.hasDetails
                          ? 'text-sky-600 dark:text-sky-400'
                          : 'text-muted-foreground/60',
                      )}
                      aria-hidden
                    />
                  )}
                  {kind === 'PIX' ? 'Cadastro PIX' : 'Cadastro TED'}
                </DialogTitle>
              </DialogHeader>
              {isLoading && vinculoId ? (
                <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Carregando…
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_7.5rem]">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="pv-razao"
                        className="text-foreground/90 text-sm font-medium leading-none"
                      >
                        Razão social
                      </label>
                      <Input
                        id="pv-razao"
                        value={v ? razaoDisplay : '—'}
                        readOnly
                        tabIndex={-1}
                        className="text-foreground border-input bg-muted/50 cursor-default select-text"
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="userCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Código</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              autoComplete="off"
                              inputMode="text"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  {kind === 'PIX' ? (
                    <FormField
                      control={form.control}
                      name="pixChave"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Chave PIX</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="E-mail, telefone, CPF, CNPJ ou chave aleatória"
                              autoComplete="off"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
                        <FormField
                          control={form.control}
                          name="tedBanco"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Banco</FormLabel>
                              <FormControl>
                                <Input {...field} autoComplete="off" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="tedAgencia"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Agência</FormLabel>
                              <FormControl>
                                <Input {...field} autoComplete="off" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
                        <FormField
                          control={form.control}
                          name="tedConta"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Conta corrente (C/C)</FormLabel>
                              <FormControl>
                                <Input {...field} autoComplete="off" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="tedCnpj"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>CNPJ</FormLabel>
                              <FormControl>
                                <Input {...field} autoComplete="off" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </>
                  )}
                  {loadErr ? (
                    <p className="text-destructive text-sm" role="alert">
                      {loadErr}
                    </p>
                  ) : null}
                  {saveRootError ? (
                    <p className="text-destructive text-sm" role="alert">
                      {String(saveRootError.message ?? '')}
                    </p>
                  ) : null}
                </div>
              )}
              <DialogFooter className="mt-6 gap-2 p-0 sm:gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={
                    save.isPending || isLoading || !vinculoId
                  }
                >
                  {save.isPending ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Salvando…
                    </>
                  ) : (
                    'Salvar'
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
