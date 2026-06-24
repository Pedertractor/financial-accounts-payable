/** Chave estável para deduplicar linhas importadas no mesmo run. */

function dateKey(d: Date | null | undefined): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function amountKey(amount: number | { toString(): string }): string {
  const n = typeof amount === 'number' ? amount : Number(amount);
  return Number.isFinite(n) ? n.toFixed(2) : String(amount);
}

export function bankImportIdentityKey(record: {
  nossoNumero: string | null | undefined;
  beneficiaryNameNorm: string | null | undefined;
  amount: number | { toString(): string };
  dueDate: Date | null | undefined;
}): string {
  const amt = amountKey(record.amount);
  const due = dateKey(record.dueDate ?? null);
  const nn = record.nossoNumero?.trim();
  if (nn) {
    return `b:nn:${nn}|${amt}|${due}`;
  }
  const name = record.beneficiaryNameNorm?.trim() ?? '';
  return `b:nm:${name}|${amt}|${due}`;
}

export function internalImportIdentityKey(record: {
  supplierCode: number | null | undefined;
  invoiceNumber: string | null | undefined;
  supplierNameNorm: string | null | undefined;
  amount: number | { toString(): string };
  dueDate: Date | null | undefined;
}): string {
  const amt = amountKey(record.amount);
  const due = dateKey(record.dueDate ?? null);
  const inv = record.invoiceNumber?.trim();
  if (record.supplierCode != null && inv) {
    return `i:si:${record.supplierCode}|${inv}|${amt}`;
  }
  const name = record.supplierNameNorm?.trim() ?? '';
  return `i:nm:${name}|${amt}|${due}`;
}
