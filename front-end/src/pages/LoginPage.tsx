import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { Eye, EyeOff } from 'lucide-react';
import { displayCardNumber, parseCardNumberInput } from '@/lib/card-number';
import { loginRequest } from '@/lib/api';
import {
  fetchVinculosReconciliationRunId,
  VINCULOS_RUN_QUERY_STALE_MS,
  vinculosReconciliationRunQueryKey,
} from '@/lib/reconcile-run-session';
import { setStoredConciliationUnit } from '@/lib/reconcile-storage';
import { AppFooter } from '@/components/app-footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const UNITS = [
  { value: 'PEDERTRACTOR', label: 'Pedertractor' },
  { value: 'TRACTOR', label: 'Tractor' },
] as const;

const loginSchema = z
  .object({
    cardNumber: z
      .string()
      .min(1, 'Informe o número do cartão')
      .regex(/^\d{1,4}$/, 'Use até 4 dígitos numéricos'),
    unit: z.string(),
    password: z.string().min(1, 'Informe a senha'),
  })
  .superRefine((data, ctx) => {
    if (data.unit !== 'PEDERTRACTOR' && data.unit !== 'TRACTOR') {
      ctx.addIssue({
        code: 'custom',
        path: ['unit'],
        message: 'Selecione a unidade da empresa',
      });
    }
  });

type LoginFormValues = z.infer<typeof loginSchema>;

const fieldClass =
  'h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-[color,box-shadow] outline-none ' +
  'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 ' +
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20 ' +
  'md:text-sm';

const labelClass = 'text-foreground/90 text-sm font-medium leading-none';

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { cardNumber: '', unit: '', password: '' },
  });

  const loginMutation = useMutation({
    mutationFn: loginRequest,
    onSuccess: async (res, variables) => {
      if (res.firstLoginRequired) {
        navigate('/primeiro-acesso', {
          replace: true,
          state: { user: res.user },
        });
        return;
      }
      if (!res.token) {
        form.setError('root', {
          message: 'Resposta inesperada: token ausente.',
        });
        return;
      }
      localStorage.setItem('reconcile_token', res.token);
      localStorage.setItem('reconcile_user', JSON.stringify(res.user));
      const unit = variables.unit;
      setStoredConciliationUnit(unit);
      try {
        await queryClient.prefetchQuery({
          queryKey: vinculosReconciliationRunQueryKey(unit),
          queryFn: ({ signal }) =>
            fetchVinculosReconciliationRunId(unit, signal),
          staleTime: VINCULOS_RUN_QUERY_STALE_MS,
        });
      } catch {
        /* a página de conciliação refaz a carga; não bloquear o login */
      }
      navigate('/conciliacao', { replace: true });
    },
    onError: (err) => {
      form.setError('root', {
        message: err instanceof Error ? err.message : 'Falha no login',
      });
    },
  });

  function onSubmit(values: LoginFormValues) {
    form.clearErrors('root');
    const d = values.cardNumber.replace(/\D/g, '').slice(0, 4);
    loginMutation.mutate({
      cardNumber: d,
      unit: values.unit as 'PEDERTRACTOR' | 'TRACTOR',
      password: values.password,
    });
  }

  const rootError = form.formState.errors.root?.message;

  return (
    <div className='bg-muted/30 flex min-h-svh flex-col'>
      <div className='flex flex-1 items-center justify-center p-4 pb-2'>
        <div className='w-full max-w-4xl'>
          <Card className='overflow-hidden p-0 shadow-sm'>
            <CardContent className='grid p-0 md:grid-cols-2'>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className='flex flex-col gap-5 p-6 md:gap-6 md:p-8'
                >
                  <div className='text-center md:text-left'>
                    <h1 className='text-2xl font-bold tracking-tight'>
                      ReconcilePro
                    </h1>
                    <p className='text-muted-foreground mt-1 text-sm text-balance'>
                      Acesse com cartão, unidade e senha.
                    </p>
                  </div>
                  {rootError ? (
                    <p
                      className='text-destructive text-center text-sm md:text-left'
                      role='alert'
                    >
                      {rootError}
                    </p>
                  ) : null}
                  <FormField
                    control={form.control}
                    name='cardNumber'
                    render={({ field, fieldState }) => {
                      return (
                        <FormItem className='space-y-1'>
                          <FormLabel className={labelClass} htmlFor='card'>
                            Nº do cartão
                          </FormLabel>
                          <FormControl>
                            <Input
                              id='card'
                              ref={field.ref}
                              name={field.name}
                              type='text'
                              inputMode='numeric'
                              autoComplete='username'
                              placeholder='cartão colaborativo'
                              value={displayCardNumber(field.value ?? '')}
                              onChange={(e) => {
                                field.onChange(
                                  parseCardNumberInput(e.target.value),
                                );
                              }}
                              onBlur={field.onBlur}
                              aria-invalid={!!fieldState.error}
                              className={cn(
                                'h-11 w-full',
                                fieldClass,
                                'py-2.5',
                              )}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                  <FormField
                    control={form.control}
                    name='unit'
                    render={({ field }) => (
                      <FormItem className='space-y-1'>
                        <FormLabel className={labelClass}>Unidade</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value || undefined}
                        >
                          <FormControl>
                            <SelectTrigger
                              className={cn(
                                fieldClass,
                                'h-9 w-full justify-between shadow-sm',
                              )}
                            >
                              <SelectValue placeholder='unidade da empresa' />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {UNITS.map((u) => (
                              <SelectItem key={u.value} value={u.value}>
                                {u.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='password'
                    render={({ field }) => (
                      <FormItem className='space-y-1'>
                        <FormLabel className={labelClass}>Senha</FormLabel>
                        <div className='relative flex h-9 items-stretch'>
                          <FormControl>
                            <Input
                              {...field}
                              name='reconcile_password'
                              id='reconcile_password'
                              type={showPassword ? 'text' : 'password'}
                              autoComplete='current-password'
                              placeholder='senha para acessar plataforma'
                              className={cn(fieldClass, 'h-9 w-full pr-10')}
                            />
                          </FormControl>
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon-sm'
                            className='text-muted-foreground hover:text-foreground absolute top-0 right-0.5 flex h-9 w-7 items-center justify-center active:translate-y-0!'
                            onClick={() => setShowPassword((p) => !p)}
                            aria-pressed={showPassword}
                            tabIndex={-1}
                            aria-label={
                              showPassword ? 'Ocultar senha' : 'Mostrar senha'
                            }
                          >
                            {showPassword ? (
                              <EyeOff className='size-4' />
                            ) : (
                              <Eye className='size-4' />
                            )}
                          </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type='submit'
                    disabled={loginMutation.isPending}
                    className='h-9 w-full text-sm font-medium'
                    size='default'
                  >
                    {loginMutation.isPending ? 'Entrando…' : 'Entrar'}
                  </Button>
                </form>
              </Form>
              <div
                className={cn(
                  'relative hidden min-h-[300px] overflow-hidden bg-zinc-950 md:block',
                )}
              >
                <div className='absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,var(--tw-gradient-stops))] from-zinc-700/50 via-zinc-900 to-zinc-950' />
                <div className='absolute right-0 bottom-0 left-0 p-8 text-white'>
                  <p className='text-sm font-medium'>Conciliação financeira</p>
                  <p className='mt-1 text-xs text-zinc-400'>
                    Importação, validação e controle de pagamentos.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <p className='text-muted-foreground mt-4 px-2 text-center text-xs'>
            Uso interno da fábrica. Não compartilhe credenciais.
          </p>
        </div>
      </div>
      <AppFooter className='shrink-0 bg-background/50' />
    </div>
  );
}
