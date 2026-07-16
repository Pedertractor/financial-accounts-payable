import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useId, useRef, useState } from 'react';
import { Calendar as CalendarIcon, ImagePlus, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { linkManualBoletoVinculo } from '@/lib/api';
import { cn } from '@/lib/utils';

const NOTES_MAX = 2000;

function isoToYmdSaoPaulo(iso: string | null | undefined): string {
  if (iso == null || iso === '') {
    return new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Sao_Paulo',
    });
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return iso;
  }
  return new Date(iso).toLocaleDateString('en-CA', {
    timeZone: 'America/Sao_Paulo',
  });
}

function ymdToLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatYmdLongPt(ymd: string): string {
  return format(ymdToLocalDate(ymd), 'PPP', { locale: ptBR });
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
  suggestionId: string;
  /** Vencimento atual do lançamento (ISO ou YYYY-MM-DD) para pré-preencher o seletor. */
  currentDueDate?: string | null;
  onSuccess?: () => void;
  /** Para desativar botões PIX/TED enquanto confirma. */
  onSubmittingChange?: (pending: boolean) => void;
};

export function BoletoManualVinculoModal({
  open,
  onOpenChange,
  runId,
  suggestionId,
  currentDueDate,
  onSuccess,
  onSubmittingChange,
}: Props) {
  const fileInputId = useId();
  const notesInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [targetDueYmd, setTargetDueYmd] = useState(() =>
    isoToYmdSaoPaulo(currentDueDate),
  );
  const [calOpen, setCalOpen] = useState(false);
  const [calMonth, setCalMonth] = useState(() =>
    ymdToLocalDate(isoToYmdSaoPaulo(currentDueDate)),
  );
  const originalDueYmd = isoToYmdSaoPaulo(currentDueDate);
  const willTransferDate = targetDueYmd !== originalDueYmd;

  const allowedMime = (f: File) => {
    const t = f.type.toLowerCase();
    if (t === 'application/pdf' || t.startsWith('image/')) {
      return true;
    }
    const name = f.name.toLowerCase();
    return name.endsWith('.pdf');
  };

  function applyFile(next: File | null) {
    if (next != null && !allowedMime(next)) {
      return;
    }
    setFile(next);
  }

  function resetForm() {
    setFile(null);
    setNotes('');
    const ymd = isoToYmdSaoPaulo(currentDueDate);
    setTargetDueYmd(ymd);
    setCalMonth(ymdToLocalDate(ymd));
    setCalOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  const mut = useMutation({
    mutationFn: () =>
      linkManualBoletoVinculo(
        runId,
        suggestionId,
        file,
        notes,
        willTransferDate ? targetDueYmd : null,
      ),
    onMutate: () => {
      onSubmittingChange?.(true);
    },
    onSettled: () => {
      onSubmittingChange?.(false);
    },
    onSuccess: () => {
      resetForm();
      onOpenChange(false);
      onSuccess?.();
      void queryClient.invalidateQueries({
        queryKey: ['reconciliation-suggestions'],
      });
    },
  });
  const err = mut.error instanceof Error ? mut.error.message : null;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          resetForm();
        } else {
          const ymd = isoToYmdSaoPaulo(currentDueDate);
          setTargetDueYmd(ymd);
          setCalMonth(ymdToLocalDate(ymd));
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className='max-w-md gap-0 p-0 sm:max-w-lg' showCloseButton>
        <div className='p-5 sm:p-6'>
          <DialogHeader className='p-0'>
            <DialogTitle className='text-left'>Vínculo manual</DialogTitle>
          </DialogHeader>
          <p className='text-muted-foreground mt-3 text-sm leading-relaxed'>
            Ao clicar em confirmar conferência, você está confirmando que existe
            vínculo, porém não encontrado pelo sistema.
          </p>
          <div className='mt-4'>
            <p className='text-foreground mb-2 text-sm font-medium'>
              Transferir vencimento
            </p>
            <p className='text-muted-foreground mb-2 text-xs leading-relaxed'>
              Use quando o par estiver em outra data. O lançamento passa a
              aparecer na triagem no dia escolhido.
            </p>
            <Popover
              open={calOpen}
              onOpenChange={(o) => {
                setCalOpen(o);
                if (o) {
                  setCalMonth(ymdToLocalDate(targetDueYmd));
                }
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  type='button'
                  variant='outline'
                  className='h-9 w-full justify-start gap-2 sm:w-auto'
                  aria-label='Escolher data de vencimento'
                >
                  <CalendarIcon
                    className='text-muted-foreground size-3.5'
                    aria-hidden
                  />
                  <span className='text-sm'>{formatYmdLongPt(targetDueYmd)}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className='w-auto p-2' align='start' sideOffset={6}>
                <Calendar
                  mode='single'
                  numberOfMonths={1}
                  className='p-0'
                  month={calMonth}
                  onMonthChange={setCalMonth}
                  selected={ymdToLocalDate(targetDueYmd)}
                  onSelect={(d) => {
                    if (!d) return;
                    setTargetDueYmd(
                      d.toLocaleDateString('en-CA', {
                        timeZone: 'America/Sao_Paulo',
                      }),
                    );
                    setCalMonth(d);
                    setCalOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
            {willTransferDate ? (
              <p className='text-amber-800 dark:text-amber-200 mt-2 text-xs' role='status'>
                Vencimento atual {formatYmdLongPt(originalDueYmd)} →{' '}
                {formatYmdLongPt(targetDueYmd)}.
              </p>
            ) : null}
          </div>
          <div className='mt-4'>
            <p className='text-foreground mb-2 text-sm font-medium'>
              Comprovante (opcional)
            </p>
            <input
              ref={fileInputRef}
              id={fileInputId}
              type='file'
              accept='image/jpeg,image/png,image/webp,image/gif,application/pdf,.pdf'
              className='sr-only'
              onChange={(e) => {
                applyFile(e.target.files?.[0] ?? null);
              }}
            />
            <button
              type='button'
              aria-label={
                file != null
                  ? `Comprovante: ${file.name}. Clique para trocar.`
                  : 'Incluir comprovante (imagem ou PDF)'
              }
              onClick={() => {
                fileInputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(true);
              }}
              onDragLeave={() => {
                setIsDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(false);
                const f = e.dataTransfer.files?.[0] ?? null;
                applyFile(f);
              }}
              className={cn(
                'focus-visible:ring-ring flex min-h-[152px] w-full flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                isDragging
                  ? 'border-primary bg-primary/10'
                  : 'border-muted-foreground/30 bg-muted/15 hover:border-muted-foreground/45 hover:bg-muted/30',
              )}
            >
              <div
                className='bg-background/80 text-primary pointer-events-none relative flex size-14 items-center justify-center rounded-2xl shadow-sm ring-1 ring-border/70'
                aria-hidden
              >
                <ImagePlus className='size-8' strokeWidth={1.5} />
              </div>
              <span className='text-foreground pointer-events-none line-clamp-2 max-w-full text-sm font-medium'>
                {file != null ? file.name : 'Incluir comprovante'}
              </span>
              <span className='text-muted-foreground pointer-events-none max-w-[272px] text-xs leading-relaxed'>
                {file != null
                  ? 'Clique para escolher outro arquivo ou arraste por cima.'
                  : 'Clique ou arraste. Imagem (JPEG, PNG, WebP, GIF) ou PDF.'}
              </span>
            </button>
            {file != null ? (
              <div className='mt-2 flex items-center justify-end'>
                <button
                  type='button'
                  className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium'
                  onClick={() => {
                    setFile(null);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                  }}
                >
                  <X className='size-3.5' aria-hidden />
                  Remover
                </button>
              </div>
            ) : null}
            <p className='text-muted-foreground/90 mt-1.5 text-center text-[0.7rem]'>
              Tamanho máximo conforme o servidor.
            </p>
          </div>
          <div className='mt-4'>
            <label
              htmlFor={notesInputId}
              className='text-foreground mb-2 block text-sm font-medium'
            >
              Observações (opcional)
            </label>
            <Textarea
              id={notesInputId}
              value={notes}
              maxLength={NOTES_MAX}
              rows={3}
              placeholder='Ex.: pago em duas parcelas, negociado com o fornecedor, etc.'
              onChange={(e) => {
                setNotes(e.target.value);
              }}
            />
            <p className='text-muted-foreground/90 mt-1.5 text-right text-[0.7rem]'>
              {notes.length}/{NOTES_MAX}
            </p>
          </div>
          {err != null && err.length > 0 ? (
            <p className='text-destructive mt-3 text-sm' role='alert'>
              {err}
            </p>
          ) : null}
          <div className='mt-6 flex flex-wrap justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
              disabled={mut.isPending}
            >
              Cancelar
            </Button>
            <Button
              type='button'
              onClick={() => {
                mut.mutate();
              }}
              disabled={mut.isPending}
            >
              {mut.isPending ? (
                <Loader2 className='me-1.5 size-4 animate-spin' />
              ) : null}
              Confirmar conferência
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
