import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { linkManualBoletoVinculo } from '@/lib/api';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
  suggestionId: string;
  onSuccess?: () => void;
  /** Para desativar botões PIX/TED enquanto confirma. */
  onSubmittingChange?: (pending: boolean) => void;
};

export function BoletoManualVinculoModal({
  open,
  onOpenChange,
  runId,
  suggestionId,
  onSuccess,
  onSubmittingChange,
}: Props) {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

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

  const mut = useMutation({
    mutationFn: () => linkManualBoletoVinculo(runId, suggestionId, file),
    onMutate: () => {
      onSubmittingChange?.(true);
    },
    onSettled: () => {
      onSubmittingChange?.(false);
    },
    onSuccess: () => {
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
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
          setFile(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
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
