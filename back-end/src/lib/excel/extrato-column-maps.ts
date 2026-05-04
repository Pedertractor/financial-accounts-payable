import { normalizeHeaderCell } from './spreadsheet-helpers.js';

export type ExtratoColumnKey =
  | 'paymentDate'
  | 'beneficiary'
  | 'documentNumber'
  | 'paymentNumber'
  | 'clientNumber'
  | 'amount'
  | 'paymentType'
  | 'status'
  | 'channel';

const SYNONYMS: Record<ExtratoColumnKey, string[]> = {
  paymentDate: ['data de pagamento', 'data pagamento', 'dt pagamento'],
  beneficiary: ['favorecido', 'nome favorecido', 'beneficiario'],
  documentNumber: [
    'n. documento:',
    'n documento',
    'n documento:',
    'documento',
    'cpf/cnpj',
  ],
  paymentNumber: ['n. pagamento:', 'n pagamento', 'pagamento'],
  clientNumber: ['n. cliente:', 'n cliente', 'cliente'],
  amount: ['valor (r$)', 'valor r$', 'valor', 'amount'],
  paymentType: ['tipo de pagamento:', 'tipo pagamento', 'tipo de pagamento'],
  status: ['situacao:', 'situação:', 'situacao', 'situação'],
  channel: ['canal:', 'canal'],
};

export function mapExtratoHeaderRow(
  headerCells: unknown[],
): Partial<Record<ExtratoColumnKey, number>> {
  const map: Partial<Record<ExtratoColumnKey, number>> = {};
  for (let c = 0; c < headerCells.length; c++) {
    const norm = normalizeHeaderCell(headerCells[c]);
    if (!norm) {
      continue;
    }
    for (const key of Object.keys(SYNONYMS) as ExtratoColumnKey[]) {
      if (map[key] !== undefined) {
        continue;
      }
      for (const syn of SYNONYMS[key]) {
        if (norm === syn || norm.includes(syn) || syn.includes(norm)) {
          map[key] = c;
          break;
        }
      }
    }
  }
  return map;
}

export function extratoRequiredColumnsPresent(
  m: Partial<Record<ExtratoColumnKey, number>>,
): boolean {
  return (
    m.beneficiary !== undefined &&
    m.amount !== undefined
  );
}
