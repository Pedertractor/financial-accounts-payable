import { Prisma } from '../../generated/prisma/client.js';

const EXCEL_UTC_OFFSET = 25569; // diferença de epoch entre JS e "Excel 1900"

const SAO_PAULO_TZ = 'America/Sao_Paulo';

/**
 * Converte qualquer instante em meia-noite (início do dia) no calendário de
 * `America/Sao_Paulo`, com offset fixo -03, **no mesmo formato** usado no
 * filtro por `date` em `reconciliation-suggestions-controller` (gte/lt).
 * Assim o vencimento da planilha, o `matchKey` (valor + dia) e o `WHERE` por
 * data batem, independentemente do fuso do servidor.
 */
function startOfSaoPauloDayFromInstant(d: Date): Date {
  if (Number.isNaN(d.getTime())) {
    return d;
  }
  const ymd = d.toLocaleDateString('en-CA', { timeZone: SAO_PAULO_TZ });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return d;
  }
  return new Date(`${ymd}T00:00:00-03:00`);
}

function parseDmyToSaoPauloMidnight(
  day: number,
  month0: number,
  y: number,
): Date {
  return new Date(
    `${y}-${String(month0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00-03:00`,
  );
}

/**
 * Converte número serial OLE/Excel (~1..59999, parte inteira) em meia-noite BRT
 * do **dia civil** que o Excel mostra para essa série. Usa ano/mês/dia **UTC**
 * do ancoramento `(serial - 25569)` em ms — não projetar esse instante com
 * `toLocaleString(SP)`, senão `24/04` em UTC-meia-noite vira dia **23** em SP.
 */
function calendarDateFromExcelSerialUtc(serial: number): Date | null {
  const wholeSerial = Math.trunc(serial);
  const ms = (wholeSerial - EXCEL_UTC_OFFSET) * 86400 * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return parseDmyToSaoPauloMidnight(
    d.getUTCDate(),
    d.getUTCMonth(),
    d.getUTCFullYear(),
  );
}

/**
 * Date devolvido por SheetJS com `cellDates: true`: instante típico = UTC-meia-noite do dia serial → mesmo critério do helper acima.
 */
function spreadsheetOleDateLikeToSaoPauloMidnight(d: Date): Date | null {
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return parseDmyToSaoPauloMidnight(
    d.getUTCDate(),
    d.getUTCMonth(),
    d.getUTCFullYear(),
  );
}

export function normalizeHeaderCell(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseBrAmount(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return new Prisma.Decimal(String(value));
  }
  if (value instanceof Prisma.Decimal) {
    return value;
  }
  const s0 = String(value).trim();
  if (!s0) return null;
  const s = s0
    .replace(/R\$\s?/gi, '')
    .replace(/\s/g, '')
    .replace(/[^\d,.\-]/g, '');

  if (s === '' || s === '-') return null;

  if (s.includes(',') && (!s.includes('.') || s.lastIndexOf(',') > s.lastIndexOf('.'))) {
    const n = s.replace(/\./g, '').replace(',', '.');
    const num = Number(n);
    return Number.isNaN(num) ? null : new Prisma.Decimal(n);
  }
  if (s.includes('.')) {
    const n = s.replace(/,/g, '');
    const num = Number(n);
    return Number.isNaN(num) ? null : new Prisma.Decimal(n);
  }
  const num = Number(s.replace(/,/g, '.'));
  return Number.isNaN(num) ? null : new Prisma.Decimal(String(num));
}

/**
 * Datas: Date do xlsx, serial Excel, string dd/mm/yyyy, ISO.
 * Valores de “dia de calendário” (vencimento) são normalizados para
 * 00:00 -03:00 (mesmo referencial do filtro por `date` na triagem).
 */
export function parseFlexibleDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    return spreadsheetOleDateLikeToSaoPauloMidnight(value);
  }
  if (typeof value === 'number' && !Number.isNaN(value)) {
    if (value > 0 && value < 100_000) {
      return calendarDateFromExcelSerialUtc(value);
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      return null;
    }
    return startOfSaoPauloDayFromInstant(d);
  }
  const s0 = String(value).trim();
  if (!s0) return null;
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(s0);
  if (m) {
    const day = parseInt(m[1]!, 10);
    const mon = parseInt(m[2]!, 10) - 1;
    let y = parseInt(m[3]!, 10);
    if (y < 100) y += 2000;
    const d = parseDmyToSaoPauloMidnight(day, mon, y);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s0);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return startOfSaoPauloDayFromInstant(d);
}

export function isRowEmpty(
  row: unknown[],
  maxCol: number,
): boolean {
  for (let c = 0; c < maxCol; c++) {
    const v = row[c];
    if (v === null || v === undefined) continue;
    if (String(v).trim() !== '') return false;
  }
  return true;
}
