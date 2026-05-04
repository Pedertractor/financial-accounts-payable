import { normalizeHeaderCell } from './spreadsheet-helpers.js';

export type BankImportField =
  | 'beneficiaryNameRaw'
  | 'amount'
  | 'dueDate'
  | 'nossoNumero'
  | 'payerNameRaw';

export type InternalImportField =
  | 'supplierNameRaw'
  | 'amount'
  | 'dueDate'
  | 'issueDate'
  | 'supplierCode'
  | 'walletCode'
  | 'branchCode'
  | 'invoiceNumber'
  | 'installment'
  | 'amountPaid'
  | 'dda'
  | 'notes';

export const BANK_COLUMN_SYNONYMS: Record<BankImportField, string[]> = {
  beneficiaryNameRaw: [
    'favorecido',
    'beneficiario',
    'beneficiário',
    'nome do favorecido',
    'fornecedor',
    'destinatario',
    'destinatário',
    'cedente',
    'razao social',
    'razão social',
    'nome',
    'descricao',
    'descrição',
  ],
  amount: [
    'valor',
    'amount',
    'vlr',
    'valor boleto',
    'valor (r$)',
    'valor r$',
    'vlr boleto',
    'valor titulo',
  ],
  dueDate: [
    'vencimento',
    'data vencimento',
    'dt vencimento',
    'dtvenc',
    'venc',
    'data de vencimento',
    'due',
    'venc.',
    'data venc',
  ],
  nossoNumero: [
    'nosso numero',
    'nosso número',
    'nosso n',
    'nosso n.',
    'n nosso',
  ],
  payerNameRaw: ['pagador', 'sacado', 'emitente', 'nome pagador'],
};

export const INTERNAL_COLUMN_SYNONYMS: Record<InternalImportField, string[]> = {
  supplierNameRaw: [
    'fornecedor',
    'razao social',
    'razão social',
    'nome fornecedor',
    'fornecedor razao',
    'credor',
  ],
  amount: ['valor', 'amount', 'vlr', 'valor titulo', 'vlr documento', 'total'],
  dueDate: [
    'vencimento',
    'data vencimento',
    'dt vencimento',
    'dtvenc',
    'dt venc',
    'venc',
    'data venc',
  ],
  issueDate: [
    'emissao',
    'emissão',
    'data emissao',
    'dt emissao',
    'emiss',
  ],
  supplierCode: [
    'codigo fornecedor',
    'código fornecedor',
    'cod fornecedor',
    'id fornecedor',
    'cod. forn',
  ],
  walletCode: [
    'carteira',
    'cod carteira',
    'cód carteira',
    'wallet',
    'cod. carteira',
  ],
  branchCode: ['filial', 'branch', 'unidade', 'cod filial'],
  invoiceNumber: [
    'nota',
    'nfe',
    'numero nota',
    'número nota',
    'nf',
    'documento',
    'num documento',
  ],
  installment: ['parcela', 'parc', 'parcela no', 'installment', 'n parcela'],
  amountPaid: ['valor pago', 'pago', 'amount paid', 'vlr pago'],
  dda: ['dda'],
  notes: ['observacao', 'observação', 'obs', 'comentario', 'comentário'],
};

function cellMatchesHeader(cell: unknown, synonyms: string[]): boolean {
  const h = normalizeHeaderCell(cell);
  if (!h) return false;
  for (const rawSyn of synonyms) {
    const n = normalizeHeaderCell(rawSyn);
    if (!n) continue;
    if (h === n) return true;
    if (n.length >= 3 && (h.includes(n) || n.includes(h))) return true;
  }
  return false;
}

export function detectHeaderRowAndColumns(
  matrix: unknown[][],
  fieldSynonyms: Record<string, string[]>,
  minMatchedFields: number,
): { headerRowIndex: number; columnByField: Record<string, number> } | null {
  const maxR = Math.min(40, matrix.length);
  let best: {
    headerRowIndex: number;
    columnByField: Record<string, number>;
  } | null = null;
  let bestScore = 0;

  for (let r = 0; r < maxR; r++) {
    const row = matrix[r];
    if (!row || !Array.isArray(row)) continue;
    const columnByField: Record<string, number> = {};
    const rowLen = row.length;
    for (let c = 0; c < rowLen; c++) {
      for (const field of Object.keys(fieldSynonyms)) {
        if (columnByField[field] !== undefined) continue;
        const syns = fieldSynonyms[field];
        if (!syns) continue;
        if (cellMatchesHeader(row[c], syns)) {
          columnByField[field] = c;
        }
      }
    }
    const score = Object.keys(columnByField).length;
    if (score > bestScore) {
      bestScore = score;
      best = { headerRowIndex: r, columnByField };
    }
  }

  if (!best || bestScore < minMatchedFields) {
    return null;
  }
  return best;
}

/**
 * Planilhas ERP com coluna "NOME" (texto) e "FORNECEDOR" (código) devem preferir
 * a coluna do nome vindo de NOME, não do código.
 */
export function preferInternalSupplierNameColumn(
  matrix: unknown[][],
  headerRowIndex: number,
  columnByField: Record<string, number | undefined>,
): void {
  const row = matrix[headerRowIndex] as unknown[] | undefined;
  if (!row) {
    return;
  }
  for (let c = 0; c < row.length; c++) {
    const h = normalizeHeaderCell(row[c]);
    if (
      h === 'nome' ||
      h === 'nome fornecedor' ||
      h === 'razao social' ||
      h === 'fornecedor nome'
    ) {
      columnByField.supplierNameRaw = c;
      return;
    }
  }
}
