import { cn } from '@/lib/utils'

type AppFooterProps = {
  className?: string
}

/**
 * Crédito superficial às marcas; texto discreto no rodapé.
 */
export function AppFooter({ className }: AppFooterProps) {
  return (
    <footer
      className={cn(
        'text-muted-foreground/80 border-border/50 mt-auto border-t py-2 text-center text-[0.65rem] leading-tight',
        className,
      )}
    >
      @Pedertractor & Tractorcomponents
    </footer>
  )
}
