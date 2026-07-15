import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router'
import { AppFooter } from '@/components/app-footer'
import { AppSidebar } from '@/components/app-sidebar'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  ApiRequestError,
  clearStoredSession,
  getMeUserRequest,
  getStoredToken,
} from '@/lib/api'
import { clearReconcileClientState } from '@/lib/reconcile-storage'

type StoredUser = { name: string; role?: string }

function readUser(): StoredUser {
  try {
    const r = localStorage.getItem('reconcile_user')
    if (!r) return { name: 'Usuário' }
    return JSON.parse(r) as StoredUser
  } catch {
    return { name: 'Usuário' }
  }
}

function segmentTitle(pathname: string): string {
  if (pathname === '/importar') return 'Importar Dados'
  if (pathname === '/conciliacoes') return 'Conciliações'
  if (pathname === '/conciliacao') return 'Conciliação'
  if (pathname === '/contas') return 'Contas pagas'
  if (pathname === '/pix-ted') return 'PIX & TED'
  if (pathname === '/usuarios') return 'Usuários'
  if (pathname === '/') return 'Início'
  return 'TractorPay'
}

/** Respostas do GET /users/me que indicam sessão inválida ou usuário sem acesso. */
function isSessionFatalStatus(status: number | null): boolean {
  return status === 401 || status === 403 || status === 404
}

function AppShellMain() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState<StoredUser>(() => readUser())
  const [sessionReady, setSessionReady] = useState(false)
  const pageTitle = segmentTitle(location.pathname)
  const { isMobile, openMobile, setOpenMobile } = useSidebar()

  const exitToLogin = useCallback(() => {
    clearStoredSession()
    clearReconcileClientState()
    navigate('/login', { replace: true })
  }, [navigate])

  useEffect(() => {
    let cancelled = false

    async function validateSession() {
      if (!getStoredToken()) {
        exitToLogin()
        return
      }
      try {
        const { user: u } = await getMeUserRequest()
        if (cancelled) return
        localStorage.setItem('reconcile_user', JSON.stringify(u))
        setUser({ name: u.name, role: u.role })
      } catch (e) {
        if (cancelled) return
        const status = e instanceof ApiRequestError ? e.status : null
        if (isSessionFatalStatus(status)) {
          exitToLogin()
          return
        }
      }
      if (!cancelled) setSessionReady(true)
    }

    void validateSession()
    return () => {
      cancelled = true
    }
  }, [exitToLogin])

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined

    function onVisibility() {
      if (document.visibilityState !== 'visible') return
      if (!getStoredToken()) return
      clearTimeout(debounce)
      debounce = setTimeout(() => {
        void (async () => {
          try {
            const { user: u } = await getMeUserRequest()
            localStorage.setItem('reconcile_user', JSON.stringify(u))
            setUser({ name: u.name, role: u.role })
          } catch (e) {
            const status = e instanceof ApiRequestError ? e.status : null
            if (isSessionFatalStatus(status)) exitToLogin()
          }
        })()
      }, 400)
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimeout(debounce)
    }
  }, [exitToLogin])

  function onSignOut() {
    exitToLogin()
  }

  function handleInsetClick(e: MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest?.('[data-sidebar="trigger"]')) {
      return
    }
    if (isMobile && openMobile) {
      setOpenMobile(false)
    }
  }

  if (!sessionReady) {
    return (
      <div className="bg-background text-muted-foreground flex min-h-svh items-center justify-center text-sm">
        Validando sessão…
      </div>
    )
  }

  return (
    <>
      <AppSidebar user={user} onSignOut={onSignOut} />
      <SidebarInset onClick={handleInsetClick}>
        <header className="bg-background group-has-data-[collapsible=icon]/sidebar-wrapper:h-10 flex h-11 shrink-0 items-center gap-2 border-b px-3 transition-[width,height] ease-linear">
          <SidebarTrigger className="-ml-0.5" />
          <div
            className="bg-border mr-1.5 h-4 w-px shrink-0"
            role="separator"
            aria-orientation="vertical"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <Link
                  to="/conciliacao"
                  className="text-muted-foreground hover:text-foreground text-sm leading-none"
                >
                  TractorPay
                </Link>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="text-sm leading-none">{pageTitle}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto">
            <Outlet />
          </div>
          <AppFooter className="bg-background shrink-0" />
        </div>
      </SidebarInset>
    </>
  )
}

export function AppShell() {
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={false}>
        <AppShellMain />
      </SidebarProvider>
    </TooltipProvider>
  )
}
