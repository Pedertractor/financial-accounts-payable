import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useLocation, useNavigate, Navigate } from 'react-router';
import { z } from 'zod';
import { Eye, EyeOff, User } from 'lucide-react';
import { displayCardNumber } from '@/lib/card-number';
import { completeFirstPasswordRequest, type PublicUser } from '@/lib/api';
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
import { cn } from '@/lib/utils';

const firstPasswordSchema = z
  .object({
    newPassword: z
      .string()
      .min(6, 'A nova senha deve ter no mínimo 6 caracteres'),
    confirmPassword: z.string().min(1, 'Confirme a nova senha'),
  })
  .superRefine((data, ctx) => {
    if (data.newPassword !== data.confirmPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'As senhas não coincidem',
      });
    }
  });

type FirstPasswordFormValues = z.infer<typeof firstPasswordSchema>;

const fieldClass =
  'h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-[color,box-shadow] outline-none ' +
  'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 ' +
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20 ' +
  'md:text-sm';

const labelClass = 'text-foreground/90 text-sm font-medium leading-none';

type FirstPasswordLocationState = {
  user: PublicUser;
};

const UNIT_LABEL: Record<string, string> = {
  PEDERTRACTOR: 'Pedertractor',
  TRACTOR: 'Tractor',
};

export function FirstPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as FirstPasswordLocationState | null;
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const form = useForm<FirstPasswordFormValues>({
    resolver: zodResolver(firstPasswordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const mutation = useMutation({
    mutationFn: completeFirstPasswordRequest,
    onSuccess: (res) => {
      if (!res.token) {
        form.setError('root', { message: 'Resposta inesperada do servidor' });
        return;
      }
      localStorage.setItem('reconcile_token', res.token);
      localStorage.setItem('reconcile_user', JSON.stringify(res.user));
      navigate('/conciliacao', { replace: true });
    },
    onError: (err) => {
      form.setError('root', {
        message: err instanceof Error ? err.message : 'Falha ao salvar a senha',
      });
    },
  });

  if (!state?.user?.id) {
    return <Navigate to='/login' replace />;
  }

  const user = state.user;

  function onSubmit(values: FirstPasswordFormValues) {
    form.clearErrors('root');
    mutation.mutate({ userId: user.id, newPassword: values.newPassword });
  }

  const rootError = form.formState.errors.root?.message;
  const cardDisplay = displayCardNumber(user.cardNumber);

  return (
    <div className='bg-muted/30 flex min-h-svh flex-col'>
      <div className='flex flex-1 items-center justify-center p-4 pb-2'>
        <div className='w-full max-w-4xl'>
          <Card className='overflow-hidden p-0 shadow-sm'>
            <CardContent className='grid p-0 md:grid-cols-2'>
              <div
                className={cn(
                  'relative hidden min-h-[300px] overflow-hidden bg-zinc-950 md:block',
                )}
              >
                <div className='absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,var(--tw-gradient-stops))] from-zinc-700/50 via-zinc-900 to-zinc-950' />
                <div className='absolute right-0 bottom-0 left-0 p-8 text-white'>
                  <p className='text-sm font-medium'>Defina sua senha</p>
                  <p className='mt-1 text-xs text-zinc-400'>
                    Segurança do primeiro acesso. Depois disso, use o login
                    comum.
                  </p>
                </div>
              </div>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className='flex flex-col gap-5 p-6 md:gap-6 md:p-8'
                >
                  <div>
                    <h1 className='text-center text-2xl font-bold tracking-tight md:text-left'>
                      ReconcilePro
                    </h1>
                    <div className='border-border/60 bg-muted/40 mt-4 flex gap-3 rounded-lg border p-3 text-left'>
                      <div
                        className='bg-background text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full border shadow-sm'
                        aria-hidden
                      >
                        <User className='size-5' strokeWidth={1.75} />
                      </div>
                      <div className='min-w-0 flex-1 space-y-1'>
                        <p className='text-foreground/95 text-sm leading-snug font-semibold tracking-tight uppercase'>
                          {user.name}
                        </p>
                        <p className='text-muted-foreground text-xs leading-snug'>
                          cartão {cardDisplay} ·{' '}
                          {UNIT_LABEL[user.unit] ?? user.unit}
                        </p>
                      </div>
                    </div>
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
                    name='newPassword'
                    render={({ field }) => (
                      <FormItem className='space-y-1'>
                        <FormLabel className={labelClass} htmlFor='new_pwd'>
                          Nova senha
                        </FormLabel>
                        <div className='relative flex h-9 items-stretch'>
                          <FormControl>
                            <Input
                              {...field}
                              id='new_pwd'
                              name='reconcile_new_password'
                              type={showNew ? 'text' : 'password'}
                              autoComplete='new-password'
                              placeholder='mínimo 6 caracteres'
                              className={cn(fieldClass, 'h-9 w-full pr-10')}
                            />
                          </FormControl>
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon-sm'
                            className='text-muted-foreground hover:text-foreground absolute top-0 right-0.5 flex h-9 w-7 items-center justify-center active:!translate-y-0'
                            onClick={() => setShowNew((p) => !p)}
                            aria-pressed={showNew}
                            tabIndex={-1}
                            aria-label={
                              showNew ? 'Ocultar senha' : 'Mostrar senha'
                            }
                          >
                            {showNew ? (
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
                  <FormField
                    control={form.control}
                    name='confirmPassword'
                    render={({ field }) => (
                      <FormItem className='space-y-1'>
                        <FormLabel
                          className={labelClass}
                          htmlFor='confirm_pwd'
                        >
                          Confirmar senha
                        </FormLabel>
                        <div className='relative flex h-9 items-stretch'>
                          <FormControl>
                            <Input
                              {...field}
                              id='confirm_pwd'
                              name='reconcile_confirm_password'
                              type={showConfirm ? 'text' : 'password'}
                              autoComplete='new-password'
                              placeholder='repita a nova senha'
                              className={cn(fieldClass, 'h-9 w-full pr-10')}
                            />
                          </FormControl>
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon-sm'
                            className='text-muted-foreground hover:text-foreground absolute top-0 right-0.5 flex h-9 w-7 items-center justify-center active:!translate-y-0'
                            onClick={() => setShowConfirm((p) => !p)}
                            aria-pressed={showConfirm}
                            tabIndex={-1}
                            aria-label={
                              showConfirm
                                ? 'Ocultar confirmação'
                                : 'Mostrar confirmação'
                            }
                          >
                            {showConfirm ? (
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
                  <div className='flex flex-col gap-2'>
                    <Button
                      type='submit'
                      disabled={mutation.isPending}
                      className='h-9 w-full text-sm font-medium'
                      size='default'
                    >
                      {mutation.isPending ? 'Salvando…' : 'Concluir e entrar'}
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      className='text-muted-foreground h-9 w-full text-sm'
                      onClick={() => navigate('/login', { replace: true })}
                    >
                      Voltar ao login
                    </Button>
                  </div>
                </form>
              </Form>
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
