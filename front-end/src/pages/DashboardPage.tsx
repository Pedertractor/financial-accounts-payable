import { Link } from 'react-router'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function DashboardPage() {
  return (
    <div className="max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Início</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Use o menu para importar planilhas do banco e do sistema interno.
      </p>
      <Link
        to="/importar"
        className={cn(buttonVariants(), 'mt-4 inline-flex')}
      >
        Ir para Importar Dados
      </Link>
    </div>
  )
}
