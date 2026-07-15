import * as React from 'react'
import { Banknote, Building2, Database, FileSpreadsheet, Home, Layers, Users, Wallet } from 'lucide-react'
import { NavMain } from '@/components/nav-main'
import { NavProjects } from '@/components/nav-projects'
import { NavUser } from '@/components/nav-user'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'

type AppSidebarProps = {
  user: { name: string; email?: string; role?: string }
  onSignOut: () => void
} & React.ComponentProps<typeof Sidebar>

function buildNavItems(role?: string) {
  const base = [
    { title: 'Dashboard', url: '/', icon: Home, soon: true },
    { title: 'Importar Dados', url: '/importar', icon: FileSpreadsheet },
    { title: 'Conciliações', url: '/conciliacoes', icon: Layers },
    { title: 'Conciliação', url: '/conciliacao', icon: Database },
    { title: 'Contas pagas', url: '/contas', icon: Banknote },
    { title: 'PIX & TED', url: '/pix-ted', icon: Wallet },
  ] as const
  const admin =
    role === 'FINANCIAL' || role === 'ADMIN'
      ? ([{ title: 'Usuários', url: '/usuarios', icon: Users }] as const)
      : ([] as const)
  return [...base, ...admin] as const
}

export function AppSidebar({ user, onSignOut, ...props }: AppSidebarProps) {
  const navItems = buildNavItems(user.role)

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-0 flex h-12 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md p-2">
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
                <Building2 className="size-4" />
              </div>
              <div className="min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-semibold">TractorPay</span>
              </div>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={[...navItems]} />
        <NavProjects projects={[]} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          onSignOut={onSignOut}
          user={{
            name: user.name,
            email: user.email ?? '',
            avatar: '',
          }}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
