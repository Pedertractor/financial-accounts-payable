import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirmYes: () => void
  isPending?: boolean
}

/**
 * Pergunta se a conta foi paga; "Sim" confirma persistência no back-end.
 */
export function AccountPaidConfirmDialog({
  open,
  onOpenChange,
  onConfirmYes,
  isPending,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md gap-0 p-0 sm:max-w-md"
        showCloseButton={!isPending}
      >
        <div className="p-5 sm:p-6">
        <DialogHeader className="p-0">
          <DialogTitle>Pagamento</DialogTitle>
          <DialogDescription>
            A conta foi paga?
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Não
          </Button>
          <Button
            type="button"
            className="inline-flex items-center gap-2"
            disabled={isPending}
            onClick={onConfirmYes}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 shrink-0 animate-spin" />
                Salvando
              </>
            ) : (
              'Sim'
            )}
          </Button>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
