import { Navigate, Outlet, Route, Routes } from 'react-router'
import { AppShell } from '@/components/app-shell'
import { getStoredToken } from '@/lib/api'
import { FirstPasswordPage } from '@/pages/FirstPasswordPage'
import { ImportDataPage } from '@/pages/ImportDataPage'
import { LoginPage } from '@/pages/LoginPage'
import { PixTedPage } from '@/pages/PixTedPage'
import { ContasPage } from '@/pages/ContasPage'
import { VinculosPage } from '@/pages/VinculosPage'
import { UsersPage } from '@/pages/UsersPage'

function RequireAuth() {
  if (!getStoredToken()) {
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}

const App = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/primeiro-acesso" element={<FirstPasswordPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/conciliacao" replace />} />
          <Route path="/importar" element={<ImportDataPage />} />
          <Route path="/conciliacao" element={<VinculosPage />} />
          <Route path="/contas" element={<ContasPage />} />
          <Route path="/pix-ted" element={<PixTedPage />} />
          <Route path="/usuarios" element={<UsersPage />} />
          <Route path="/pix" element={<Navigate to="/pix-ted" replace />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
