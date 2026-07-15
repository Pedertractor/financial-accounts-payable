/** Formatação compartilhada PT-BR (BRL e datas dia/mês/ano). Não duplicar em páginas. */

export function formatBrlAmount(raw: string | number | null | undefined): string {
  if (raw == null || raw === '') {
    return '—'
  }
  const n = typeof raw === 'number' ? raw : Number.parseFloat(raw)
  if (Number.isNaN(n)) {
    return String(raw)
  }
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export function formatDatePt(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    }
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

export function formatDateTimePt(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}
