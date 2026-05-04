/** Exibição alinhada ao login: preenche com zeros até 4 caracteres. */
export function displayCardNumber(stored: string): string {
  if (stored.length === 0) return ''
  if (stored.length < 4) return stored.padStart(4, '0')
  return stored
}

/** Dígitos reais (máx. 4); trata 5+ caracteres ao continuar a digitar sobre a máscara. */
export function parseCardNumberInput(raw: string): string {
  const d = raw.replace(/\D/g, '')
  if (d.length === 0) return ''
  if (d.length > 4) {
    return (d.replace(/^0+/, '') || d).slice(0, 4)
  }
  return d
}
