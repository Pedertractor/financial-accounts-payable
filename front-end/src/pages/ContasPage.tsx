import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ArrowDown,
  ArrowUp,
  Calendar as CalendarIcon,
  Check,
  Loader2,
  Minus,
  Upload,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  SuggestionDetailModal,
  type ExtratoBankLineForModal,
} from '@/components/suggestion-detail-modal';
import {
  getBankExtratoState,
  listRunSuggestions,
  postBankExtratoManualMatch,
  requestInitWithTimeout,
  uploadBankExtratoFile,
  type BankExtratoStateResponse,
  type SuggestionListItem,
  type SuggestionListResponse,
} from '@/lib/api';
import {
  fetchVinculosReconciliationRunId,
  VINCULOS_RUN_QUERY_GC_MS,
  VINCULOS_RUN_QUERY_STALE_MS,
} from '@/lib/reconcile-run-session';
import {
  getStoredConciliationUnitForVinculos,
  setStoredConciliationUnit,
  setStoredVinculosDateRange,
  getStoredVinculosDateRange,
  type ConciliationUnit,
  type VinculosDateRangeYmd,
} from '@/lib/reconcile-storage';
import { cn } from '@/lib/utils';

/** Mostra ~10 linhas; o restante exige scroll vertical (as duas tabelas da página). */
const CONTAS_TABLE_SCROLL_WRAP =
  'max-h-[min(28rem,55vh)] overflow-y-auto overflow-x-auto';
const CONTAS_TABLE_HEADER_STICKY =
  'bg-card sticky top-0 z-10 shadow-[0_1px_0_0_hsl(var(--border))]';

function formatBrlAmount(raw: string | null): string {
  if (raw == null || raw === '') {
    return '—';
  }
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n)) {
    return raw;
  }
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function formatDatePt(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    }
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function ymdToLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatYmdLongPt(ymd: string): string {
  return format(ymdToLocalDate(ymd), 'PPP', { locale: ptBR });
}

function formatCompareRangeLabel(range: VinculosDateRangeYmd): string {
  if (range.from === range.to) {
    return formatYmdLongPt(range.from);
  }
  return `${formatYmdLongPt(range.from)} – ${formatYmdLongPt(range.to)}`;
}

type SortColumn = 'index' | 'amount' | 'forma' | 'externo' | 'interno';
type SortDir = 'asc' | 'desc';

function parseAmount(n: string | null | undefined): number {
  if (n == null || n === '') {
    return Number.NaN;
  }
  return Number.parseFloat(n);
}

function amountForSort(r: SuggestionListItem): number {
  const bank = parseAmount(r.amountBank);
  if (!Number.isNaN(bank)) {
    return bank;
  }
  const inter = parseAmount(r.amountInternal);
  if (!Number.isNaN(inter)) {
    return inter;
  }
  return parseAmount(r.amount);
}

/** Valor único (banco/ERP alinhado ou prioridade ao banco se divergirem). */
function settledPaidAmountDisplay(r: SuggestionListItem): string {
  const b = parseAmount(r.amountBank);
  const i = parseAmount(r.amountInternal);
  if (!Number.isNaN(b) && !Number.isNaN(i)) {
    if (Math.abs(b - i) < 0.005) {
      return formatBrlAmount(r.amountBank ?? r.amountInternal ?? null);
    }
    return formatBrlAmount(r.amountBank ?? null);
  }
  if (!Number.isNaN(b)) return formatBrlAmount(r.amountBank ?? null);
  if (!Number.isNaN(i)) return formatBrlAmount(r.amountInternal ?? null);
  return formatBrlAmount(r.amount ?? null);
}

function settledAmountTooltip(r: SuggestionListItem): string | undefined {
  const b = parseAmount(r.amountBank);
  const i = parseAmount(r.amountInternal);
  if (!Number.isNaN(b) && !Number.isNaN(i) && Math.abs(b - i) >= 0.005) {
    return `Banco: ${formatBrlAmount(r.amountBank ?? null)} · ERP: ${formatBrlAmount(r.amountInternal ?? null)}`;
  }
  return undefined;
}

function formaForSort(r: SuggestionListItem): string {
  const k = getApprovedPaymentVinculoKind(r);
  if (k === 'PIX') return '1_PIX';
  if (k === 'TED') return '2_TED';
  if (k === 'BOLETO') return '3_BOLETO';
  return '4_COMUM';
}

function FormaPagamentoCell({ row }: { row: SuggestionListItem }) {
  const k = getApprovedPaymentVinculoKind(row);
  if (k === 'PIX') {
    return (
      <Badge variant='secondary' className='text-xs font-medium'>
        PIX
      </Badge>
    );
  }
  if (k === 'TED') {
    return (
      <Badge
        variant='secondary'
        className='border-sky-200 bg-sky-50 text-xs font-medium text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100'
      >
        TED
      </Badge>
    );
  }
  if (k === 'BOLETO') {
    return (
      <Badge
        variant='secondary'
        className='border-orange-200 bg-orange-50 text-xs font-medium text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-100'
      >
        Boleto
      </Badge>
    );
  }
  return <span className='text-muted-foreground text-xs'>Pagamento comum</span>;
}

function compareDisplayName(
  a: SuggestionListItem,
  b: SuggestionListItem,
  get: (r: SuggestionListItem) => string,
  dir: SortDir,
): number {
  const sa = (get(a) ?? '').trim();
  const sb = (get(b) ?? '').trim();
  const aEmpty = sa === '';
  const bEmpty = sb === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  const cmp = sa.localeCompare(sb, 'pt-BR', {
    numeric: true,
    sensitivity: 'base',
  });
  if (cmp !== 0) {
    return dir === 'asc' ? cmp : -cmp;
  }
  return 0;
}

function getApprovedPaymentVinculoKind(
  r: SuggestionListItem,
): 'PIX' | 'TED' | 'BOLETO' | null {
  if (
    r.paymentVinculoKind === 'PIX'
    || r.paymentVinculoKind === 'TED'
    || r.paymentVinculoKind === 'BOLETO'
  ) {
    return r.paymentVinculoKind;
  }
  if (r.reason === 'PIX_VINCULO_OK') return 'PIX';
  if (r.reason === 'TED_VINCULO_OK') return 'TED';
  if (r.reason === 'BOLETO_VINCULO_OK') return 'BOLETO';
  return null;
}

const contasSuggestionsQk = (
  unit: ConciliationUnit,
  rid: string | null | undefined,
  range: VinculosDateRangeYmd,
) =>
  ['reconciliation-suggestions', unit, rid ?? null, range.from, range.to, 'pago-contas'] as const;

function keepPrev(
  unit: ConciliationUnit,
  rid: string | null | undefined,
  prev: SuggestionListResponse | undefined,
): SuggestionListResponse | undefined {
  if (prev == null || rid == null) return undefined;
  if (prev.run.id !== rid || prev.run.unit !== unit) return undefined;
  return prev;
}

function SortableTh({
  label,
  active,
  direction,
  onClick,
  className,
  screenReaderHint,
}: {
  label: string
  active: boolean
  direction: SortDir | null
  onClick: () => void
  className?: string
  screenReaderHint: string
}) {
  return (
    <Button
      type='button'
      variant='ghost'
      size='xs'
      onClick={onClick}
      title={screenReaderHint}
      className={cn(
        'text-muted-foreground -mx-1.5 h-7 gap-1 text-xs font-medium tracking-tight',
        active && 'text-foreground',
        className,
      )}
    >
      <span className='leading-none'>{label}</span>
      {active && direction != null ? (
        direction === 'asc' ? (
          <ArrowUp className='size-3.5 opacity-100' />
        ) : (
          <ArrowDown className='size-3.5 opacity-100' />
        )
      ) : null}
    </Button>
  );
}

export function ContasPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [unitFilter, setUnitFilter] = useState<ConciliationUnit>(
    getStoredConciliationUnitForVinculos,
  );
  const [compareRange, setCompareRange] = useState<VinculosDateRangeYmd>(
    getStoredVinculosDateRange,
  );
  const [calOpen, setCalOpen] = useState(false);
  const [calDate, setCalDate] = useState<Date | undefined>(() => {
    const r = getStoredVinculosDateRange();
    return ymdToLocalDate(r.from);
  });
  const [tableSort, setTableSort] = useState<{
    column: SortColumn
    dir: SortDir
  } | null>(null);
  const [suggestionDetail, setSuggestionDetail] = useState<{
    row: SuggestionListItem
    line: number
  } | null>(null);
  const [pickSuggestionForLinkId, setPickSuggestionForLinkId] = useState<string | null>(null);

  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkExtratoLineId, setLinkExtratoLineId] = useState<string | null>(null);
  const [linkJustification, setLinkJustification] = useState('');
  const [linkSelectHint, setLinkSelectHint] = useState<string | null>(null);

  useEffect(() => {
    setStoredVinculosDateRange(compareRange);
  }, [compareRange]);

  useEffect(() => {
    if (!linkSelectHint) return;
    const t = window.setTimeout(() => setLinkSelectHint(null), 5000);
    return () => clearTimeout(t);
  }, [linkSelectHint]);

  useEffect(() => {
    setStoredConciliationUnit(unitFilter);
  }, [unitFilter]);

  const {
    data: runId,
    isPending: runPending,
    isError: runIsError,
    error: runError,
    refetch: refetchRun,
  } = useQuery({
    queryKey: ['reconciliation-run', 'vinculos', unitFilter],
    queryFn: async ({ signal }) =>
      fetchVinculosReconciliationRunId(unitFilter, signal),
    staleTime: VINCULOS_RUN_QUERY_STALE_MS,
    gcTime: VINCULOS_RUN_QUERY_GC_MS,
  });

  const referenceYmdForExtrato = compareRange.from;

  const {
    data,
    isLoading: suggestionsLoading,
    isFetching: suggestionsFetching,
    isPlaceholderData: suggestionsPlaceholder,
    isError,
    error,
  } = useQuery<SuggestionListResponse>({
    queryKey: contasSuggestionsQk(unitFilter, runId, compareRange),
    queryFn: async ({ signal }) =>
      listRunSuggestions(
        runId!,
        {
          date: compareRange.from,
          endDate: compareRange.to,
          limit: 2000,
          statusFilter: 'pago',
        },
        requestInitWithTimeout(signal, 120_000),
      ),
    enabled: runId != null,
    staleTime: 60_000,
    placeholderData: (prev) => keepPrev(unitFilter, runId, prev),
  });

  const { data: extratoState } = useQuery<BankExtratoStateResponse>({
    queryKey: ['bank-extrato-state', runId, referenceYmdForExtrato],
    queryFn: ({ signal }) =>
      getBankExtratoState(runId!, { date: referenceYmdForExtrato }, requestInitWithTimeout(signal, 60_000)),
    enabled: runId != null,
    staleTime: 30_000,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!runId) throw new Error('Sem sessão');
      return uploadBankExtratoFile(runId, file, {
        date: compareRange.from,
        endDate: compareRange.to,
        referenceDate: referenceYmdForExtrato,
      });
    },
    onSuccess: () => {
      if (runId) {
        void queryClient.invalidateQueries({ queryKey: ['bank-extrato-state', runId, referenceYmdForExtrato] });
        void queryClient.invalidateQueries({ queryKey: ['reconciliation-suggestions', unitFilter, runId] });
      }
    },
  });

  const manualMatchMutation = useMutation({
    mutationFn: async (payload: { extratoLineId: string; suggestionId: string; justification: string }) => {
      if (!runId) throw new Error('Sem sessão');
      return postBankExtratoManualMatch(runId, payload);
    },
    onSuccess: () => {
      setLinkDialogOpen(false);
      setLinkExtratoLineId(null);
      setPickSuggestionForLinkId(null);
      setLinkJustification('');
      if (runId) {
        void queryClient.invalidateQueries({ queryKey: ['bank-extrato-state', runId, referenceYmdForExtrato] });
        void queryClient.invalidateQueries({ queryKey: ['reconciliation-suggestions', unitFilter, runId] });
      }
    },
  });

  const rows = useMemo(() => data?.items ?? [], [data?.items]);

  const matchedSuggestionIds = useMemo(() => {
    const s = new Set<string>();
    for (const l of extratoState?.extratoLines ?? []) {
      if (l.matchedSuggestionId) {
        s.add(l.matchedSuggestionId);
      }
    }
    return s;
  }, [extratoState?.extratoLines]);

  const extratoLinesOrdered = useMemo(
    () =>
      [...(extratoState?.extratoLines ?? [])].sort(
        (a, b) => a.rowNumber - b.rowNumber,
      ),
    [extratoState?.extratoLines],
  );

  const extratoStats = useMemo(() => {
    const n = extratoLinesOrdered.length;
    const m = extratoLinesOrdered.filter((l) => l.matchedSuggestionId).length;
    return { total: n, matched: m, unmatched: n - m };
  }, [extratoLinesOrdered]);

  /** Número de linha na tabela de contas (1…n) para abrir o modal. */
  const lineBySuggestionId = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r, i) => map.set(r.id, i + 1));
    return map;
  }, [rows]);

  /** Linha do extrato vinculada à sugestão (para o modal em linhas verdes). */
  const extratoLineBySuggestionId = useMemo(() => {
    const m = new Map<string, ExtratoBankLineForModal>();
    for (const l of extratoState?.extratoLines ?? []) {
      if (!l.matchedSuggestionId) continue;
      m.set(l.matchedSuggestionId, {
        rowNumber: l.rowNumber,
        paymentDate: l.paymentDate,
        beneficiaryRaw: l.beneficiaryRaw,
        amount: l.amount,
        paymentTypeRaw: l.paymentTypeRaw,
        matchKind: l.matchKind,
        justification: l.justification,
      });
    }
    return m;
  }, [extratoState?.extratoLines]);

  const displayRows = useMemo(() => {
    if (rows.length === 0) return [] as { row: SuggestionListItem; line: number }[];
    const withOrig = rows.map((r, orig) => ({ r, orig, line: orig + 1 }));
    if (tableSort == null) {
      return withOrig.map((x) => ({ row: x.r, line: x.line }));
    }
    if (tableSort.column === 'index') {
      withOrig.sort((a, b) =>
        tableSort.dir === 'asc' ? a.orig - b.orig : b.orig - a.orig,
      );
    } else if (tableSort.column === 'forma') {
      withOrig.sort((a, b) => {
        const cmp = formaForSort(a.r).localeCompare(formaForSort(b.r), 'pt-BR', {
          numeric: true,
          sensitivity: 'base',
        });
        return cmp !== 0
          ? (tableSort.dir === 'asc' ? cmp : -cmp)
          : a.orig - b.orig;
      });
    } else if (tableSort.column === 'externo') {
      withOrig.sort((a, b) => {
        const c = compareDisplayName(a.r, b.r, (row) => row.externalName, tableSort.dir);
        return c !== 0 ? c : a.orig - b.orig;
      });
    } else if (tableSort.column === 'interno') {
      withOrig.sort((a, b) => {
        const c = compareDisplayName(a.r, b.r, (row) => row.internalName, tableSort.dir);
        return c !== 0 ? c : a.orig - b.orig;
      });
    } else {
      withOrig.sort((a, b) => {
        const na = amountForSort(a.r);
        const nb = amountForSort(b.r);
        if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
        if (Number.isNaN(na)) return 1;
        if (Number.isNaN(nb)) return -1;
        return tableSort.dir === 'asc' ? na - nb : nb - na;
      });
    }
    return withOrig.map((x) => ({ row: x.r, line: x.line }));
  }, [rows, tableSort]);

  const showLoading =
    suggestionsLoading || (suggestionsFetching && suggestionsPlaceholder);

  function cycleSortIndex() {
    setTableSort((prev) =>
      prev?.column !== 'index'
        ? { column: 'index', dir: 'asc' }
        : prev.dir === 'asc'
          ? { column: 'index', dir: 'desc' }
          : null,
    );
  }
  function cycleSortAmount() {
    setTableSort((prev) =>
      prev?.column !== 'amount'
        ? { column: 'amount', dir: 'desc' }
        : prev.dir === 'desc'
          ? { column: 'amount', dir: 'asc' }
          : null,
    );
  }
  function cycleSortForma() {
    setTableSort((prev) =>
      prev?.column !== 'forma'
        ? { column: 'forma', dir: 'asc' }
        : prev.dir === 'asc'
          ? { column: 'forma', dir: 'desc' }
          : null,
    );
  }
  function cycleSortExterno() {
    setTableSort((prev) =>
      prev?.column !== 'externo'
        ? { column: 'externo', dir: 'asc' }
        : prev.dir === 'asc'
          ? { column: 'externo', dir: 'desc' }
          : null,
    );
  }
  function cycleSortInterno() {
    setTableSort((prev) =>
      prev?.column !== 'interno'
        ? { column: 'interno', dir: 'asc' }
        : prev.dir === 'asc'
          ? { column: 'interno', dir: 'desc' }
          : null,
    );
  }

  if (runIsError) {
    const msg =
      runError instanceof Error ? runError.message : 'Falha ao carregar a sessão.';
    return (
      <div className='p-4 text-sm' role='alert'>
        <p className='text-destructive'>{msg}</p>
        <Button type='button' variant='secondary' className='mt-3' onClick={() => void refetchRun()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (runPending) {
    return (
      <div className='flex min-h-[min(12rem,50vh)] flex-col items-center justify-center gap-3 px-4 py-12'>
        <Loader2 className='text-muted-foreground size-5 animate-spin' />
        <p className='text-muted-foreground text-sm'>Carregando sessão…</p>
      </div>
    );
  }

  return (
    <div className='bg-muted/20 flex min-h-0 flex-1 flex-col gap-4 p-3 md:p-6'>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <Wallet className='text-muted-foreground size-5 shrink-0' />
            <h1 className='text-foreground text-lg font-semibold tracking-tight md:text-xl'>
              Contas pagas
            </h1>
          </div>
        </div>

        <div className='flex w-full flex-col items-end gap-2 sm:max-w-lg'>
          <div className='flex flex-wrap items-center justify-end gap-2'>
            <Label htmlFor='contas-date' className='sr-only'>
              Data de vencimento
            </Label>
            <Popover
              open={calOpen}
              onOpenChange={(o) => {
                setCalOpen(o);
                if (o) setCalDate(ymdToLocalDate(compareRange.from));
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  type='button'
                  id='contas-date'
                  variant='outline'
                  size='sm'
                  className='gap-2'
                  aria-label='Selecionar data de vencimento'
                >
                  <CalendarIcon className='size-3.5' />
                  <span>{formatCompareRangeLabel(compareRange)}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className='w-auto overflow-hidden rounded-md p-2 shadow-md' align='end'>
                <Calendar
                  mode='single'
                  numberOfMonths={1}
                  className='p-0'
                  selected={calDate}
                  onSelect={(d) => {
                    if (!d) return;
                    setCalDate(d);
                    const ymd = format(d, 'yyyy-MM-dd');
                    setCompareRange({ from: ymd, to: ymd });
                    setCalOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>

            <input
              ref={fileRef}
              type='file'
              accept='.xlsx,.xls'
              className='hidden'
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) uploadMutation.mutate(f);
              }}
            />

            <Button
              type='button'
              size='sm'
              variant='secondary'
              className='gap-1.5'
              disabled={!runId || uploadMutation.isPending}
              onClick={() => fileRef.current?.click()}
            >
              {uploadMutation.isPending ? (
                <Loader2 className='size-3.5 animate-spin' />
              ) : (
                <Upload className='size-3.5' />
              )}
              Importar extrato
            </Button>
          </div>

          <div className='flex flex-wrap justify-end gap-1.5'>
            <Button
              type='button'
              size='xs'
              variant='outline'
              className={cn(
                unitFilter === 'PEDERTRACTOR' && 'ring-2 ring-sky-500/60 ring-offset-1',
              )}
              onClick={() => setUnitFilter('PEDERTRACTOR')}
            >
              PEDERTRACTOR
            </Button>
            <Button
              type='button'
              size='xs'
              variant='outline'
              className={cn(unitFilter === 'TRACTOR' && 'ring-2 ring-sky-500/60 ring-offset-1')}
              onClick={() => setUnitFilter('TRACTOR')}
            >
              TRACTOR
            </Button>
          </div>
        </div>
      </div>

      {linkSelectHint != null ? (
        <p className='text-amber-800 dark:text-amber-200 text-xs' role='status'>
          {linkSelectHint}
        </p>
      ) : null}
      {pickSuggestionForLinkId != null && extratoState?.import != null ? (
        <p className='text-muted-foreground text-xs'>
          Conta marcada para vínculo. Marque uma linha <strong>sem par</strong> no extrato abaixo para
          abrir o vínculo manual.
        </p>
      ) : null}

      {uploadMutation.isError && (
        <p className='text-destructive text-sm'>
          {uploadMutation.error instanceof Error
            ? uploadMutation.error.message
            : 'Falha ao importar extrato.'}
        </p>
      )}
      {isError && (
        <p className='text-destructive text-sm'>
          {error instanceof Error ? error.message : 'Não foi possível carregar contas pagas.'}
        </p>
      )}
      {manualMatchMutation.isError && (
        <p className='text-destructive text-sm'>
          {manualMatchMutation.error instanceof Error
            ? manualMatchMutation.error.message
            : 'Falha no vínculo manual.'}
        </p>
      )}

      <Card className='border-border/60 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
        <CardContent className='p-0'>
          {showLoading ? (
            <div className='flex min-h-32 items-center justify-center gap-2 py-12'>
              <Loader2 className='text-muted-foreground size-5 animate-spin' />
              <span className='text-muted-foreground text-sm'>Carregando contas pagas…</span>
            </div>
          ) : (
            <div className={cn('max-w-full', CONTAS_TABLE_SCROLL_WRAP)}>
              <Table>
                <TableHeader className={CONTAS_TABLE_HEADER_STICKY}>
                  <TableRow className='hover:bg-transparent'>
                    <TableHead className='w-10 px-1 text-center text-xs'>
                      <span className='sr-only'>Vincular ao extrato</span>
                    </TableHead>
                    <TableHead className='w-20 pl-2 pr-1 font-mono text-xs'>
                      <SortableTh label='#' active={tableSort?.column === 'index'} direction={tableSort?.column === 'index' ? tableSort.dir : null} onClick={cycleSortIndex} screenReaderHint='Ordenação por ordem na lista.' />
                    </TableHead>
                    <TableHead className='min-w-40 text-xs'>
                      <SortableTh label='Externo (banco)' active={tableSort?.column === 'externo'} direction={tableSort?.column === 'externo' ? tableSort.dir : null} onClick={cycleSortExterno} screenReaderHint='Nome no banco.' />
                    </TableHead>
                    <TableHead className='min-w-40 text-xs'>
                      <SortableTh label='Interno (ERP)' active={tableSort?.column === 'interno'} direction={tableSort?.column === 'interno' ? tableSort.dir : null} onClick={cycleSortInterno} screenReaderHint='Nome no ERP.' />
                    </TableHead>
                    <TableHead className='min-w-26 whitespace-nowrap text-xs'>Venc.</TableHead>
                    <TableHead className='min-w-36 whitespace-nowrap text-right text-xs'>
                      <SortableTh label='Valor (banco/ERP)' active={tableSort?.column === 'amount'} direction={tableSort?.column === 'amount' ? tableSort.dir : null} onClick={cycleSortAmount} screenReaderHint='Valor pago (único).' />
                    </TableHead>
                    <TableHead className='min-w-36 text-xs'>
                      <SortableTh label='Forma de pagamento' active={tableSort?.column === 'forma'} direction={tableSort?.column === 'forma' ? tableSort.dir : null} onClick={cycleSortForma} screenReaderHint='PIX, TED ou pagamento comum.' />
                    </TableHead>
                    <TableHead className='w-28 text-center text-xs'>Conferido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className='text-muted-foreground py-12 text-center text-sm'>
                        Nenhuma conta paga encontrada nesta empresa e período.
                      </TableCell>
                    </TableRow>
                  ) : (
                    displayRows.map((item, idx) => {
                      const row = item.row;
                      const matched = matchedSuggestionIds.has(row.id);
                      const openExtratoExists = extratoState?.import != null;
                      const canManualPick = openExtratoExists && !matched;
                      return (
                        <TableRow
                          key={row.id}
                          role='button'
                          tabIndex={0}
                          className={cn(
                            'border-border/40 cursor-pointer bg-muted/40 dark:bg-muted/25',
                            idx % 2 === 1 && 'bg-muted/55 dark:bg-muted/30',
                          )}
                          onClick={() => setSuggestionDetail({ row, line: item.line })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSuggestionDetail({ row, line: item.line });
                            }
                          }}
                        >
                          <TableCell
                            className='w-10 px-1 text-center align-middle'
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type='checkbox'
                              className={cn(
                                'size-4 accent-emerald-600 disabled:cursor-not-allowed disabled:opacity-40',
                              )}
                              checked={pickSuggestionForLinkId === row.id}
                              disabled={!canManualPick}
                              title={
                                canManualPick
                                  ? 'Marcar esta conta para vincular a uma linha do extrato'
                                  : matched
                                    ? 'Já conferido no extrato'
                                    : 'Importe o extrato para vincular manualmente'
                              }
                              aria-label='Selecionar conta para vínculo manual com o extrato'
                              onChange={() => {
                                if (!canManualPick) return;
                                setPickSuggestionForLinkId((id) =>
                                  id === row.id ? null : row.id,
                                );
                                setLinkSelectHint(null);
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </TableCell>
                          <TableCell className='text-muted-foreground font-mono text-xs'>
                            {item.line}
                          </TableCell>
                          <TableCell className='max-w-56 truncate text-sm'>{row.externalName}</TableCell>
                          <TableCell className='max-w-56 truncate text-sm'>{row.internalName}</TableCell>
                          <TableCell className='font-mono text-xs tabular-nums'>{formatDatePt(row.dueDate)}</TableCell>
                          <TableCell
                            className='text-right font-mono text-sm tabular-nums'
                            title={settledAmountTooltip(row)}
                          >
                            {settledPaidAmountDisplay(row)}
                          </TableCell>
                          <TableCell>
                            <FormaPagamentoCell row={row} />
                          </TableCell>
                          <TableCell className='text-center'>
                            {matched ? (
                              <Check
                                className='inline-block size-5 text-emerald-600 dark:text-emerald-400'
                                aria-label='Conferido com o extrato'
                                strokeWidth={2.5}
                              />
                            ) : (
                              <Minus
                                className='text-muted-foreground inline-block size-5'
                                aria-label='Ainda não conferido no extrato'
                                strokeWidth={2}
                              />
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {extratoState?.import != null && extratoLinesOrdered.length > 0 ? (
        <Card className='border-border/60'>
          <CardContent className='p-4'>
            <h2 className='text-foreground mb-2 text-sm font-semibold'>
              Extrato do banco ({extratoStats.matched} vinculados · {extratoStats.unmatched} sem par)
            </h2>
            <div
              className={cn(
                'max-w-full rounded-md border',
                CONTAS_TABLE_SCROLL_WRAP,
              )}
            >
              <Table>
                <TableHeader className={CONTAS_TABLE_HEADER_STICKY}>
                  <TableRow>
                    <TableHead className='w-10 px-1 text-center text-xs'>
                      <span className='sr-only'>Vincular ao extrato</span>
                    </TableHead>
                    <TableHead className='text-xs'>#</TableHead>
                    <TableHead className='text-xs'>Pagamento</TableHead>
                    <TableHead className='text-xs'>Favorecido</TableHead>
                    <TableHead className='text-right text-xs'>Valor</TableHead>
                    <TableHead className='text-xs'>Tipo</TableHead>
                    <TableHead className='text-xs'>Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {extratoLinesOrdered.map((l) => {
                    const matched = Boolean(l.matchedSuggestionId);
                    const extratoLinkedToModal = linkDialogOpen && linkExtratoLineId === l.id;
                    return (
                      <TableRow
                        key={l.id}
                        className={cn(
                          'transition-colors',
                          matched
                            ? 'cursor-pointer bg-emerald-50/90 hover:bg-emerald-100/90 dark:bg-emerald-950/35 dark:hover:bg-emerald-950/50'
                            : 'bg-muted/30',
                        )}
                        tabIndex={matched ? 0 : -1}
                        role={matched ? 'button' : undefined}
                        onClick={
                          matched && l.matchedSuggestionId
                            ? () => {
                                const sr = rows.find((x) => x.id === l.matchedSuggestionId);
                                if (sr) {
                                  setSuggestionDetail({
                                    row: sr,
                                    line: lineBySuggestionId.get(sr.id) ?? 1,
                                  });
                                }
                              }
                            : undefined
                        }
                        onKeyDown={
                          matched && l.matchedSuggestionId
                            ? (e) => {
                                if (e.key !== 'Enter' && e.key !== ' ') return;
                                e.preventDefault();
                                const sr = rows.find((x) => x.id === l.matchedSuggestionId);
                                if (sr) {
                                  setSuggestionDetail({
                                    row: sr,
                                    line: lineBySuggestionId.get(sr.id) ?? 1,
                                  });
                                }
                              }
                            : undefined
                        }
                      >
                        <TableCell
                          className='w-10 px-1 text-center align-middle'
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type='checkbox'
                            className='size-4 accent-emerald-600 disabled:cursor-not-allowed disabled:opacity-40'
                            checked={extratoLinkedToModal}
                            disabled={matched}
                            title={
                              matched
                                ? 'Linha já vinculada'
                                : pickSuggestionForLinkId
                                  ? 'Marcar para abrir o vínculo manual'
                                  : 'Marque antes uma conta na tabela de contas pagas'
                            }
                            aria-label='Selecionar linha do extrato para vínculo manual'
                            onChange={(e) => {
                              if (matched) return;
                              if (!e.target.checked) {
                                if (extratoLinkedToModal) {
                                  setLinkDialogOpen(false);
                                  setLinkExtratoLineId(null);
                                  setLinkJustification('');
                                }
                                return;
                              }
                              if (!pickSuggestionForLinkId) {
                                setLinkSelectHint(
                                  'Marque primeiro uma conta na tabela de contas pagas.',
                                );
                                return;
                              }
                              setLinkExtratoLineId(l.id);
                              setLinkDialogOpen(true);
                              setLinkSelectHint(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </TableCell>
                        <TableCell className='font-mono text-xs'>{l.rowNumber}</TableCell>
                        <TableCell className='font-mono text-xs'>{l.paymentDate ?? '—'}</TableCell>
                        <TableCell className='max-w-md truncate text-sm'>{l.beneficiaryRaw}</TableCell>
                        <TableCell className='text-right font-mono text-xs tabular-nums'>
                          {formatBrlAmount(l.amount)}
                        </TableCell>
                        <TableCell className='text-muted-foreground text-xs'>
                          {l.paymentTypeRaw ?? '—'}
                        </TableCell>
                        <TableCell className='text-xs'>
                          {matched ? (
                            <Badge
                              variant='secondary'
                              className='border-emerald-200 bg-emerald-100 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100'
                            >
                              Vinculado
                            </Badge>
                          ) : (
                            <Badge variant='outline' className='text-muted-foreground'>
                              Sem par
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : extratoState?.import != null && extratoLinesOrdered.length === 0 ? (
        <p className='text-muted-foreground px-1 text-xs'>
          O arquivo do extrato foi importado, mas nenhuma linha foi reconhecida.
        </p>
      ) : null}

      <SuggestionDetailModal
        runId={runId}
        open={suggestionDetail != null}
        row={suggestionDetail?.row ?? null}
        line={suggestionDetail?.line ?? null}
        extratoBankLine={
          suggestionDetail
            ? extratoLineBySuggestionId.get(suggestionDetail.row.id)
            : undefined
        }
        onOpenChange={(next) => !next && setSuggestionDetail(null)}
        onResolved={() => {
          if (runId) {
            void queryClient.invalidateQueries({
              queryKey: ['reconciliation-suggestions', unitFilter, runId],
            });
          }
          setSuggestionDetail(null);
        }}
      />

      <Dialog
        open={linkDialogOpen}
        onOpenChange={(o) => {
          setLinkDialogOpen(o);
          if (!o) {
            setLinkExtratoLineId(null);
            setLinkJustification('');
          }
        }}
      >
        <DialogContent showCloseButton className='gap-0'>
          <DialogHeader className='px-6 pt-6 pb-2'>
            <DialogTitle>Vincular conta ao extrato</DialogTitle>
            <DialogDescription>
              Explique por que valores ou nomes divergem (por exemplo juros ou diferença na razão social).
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-2 px-6 pb-2'>
            <Label htmlFor='link-just'>Justificativa</Label>
            <Input
              id='link-just'
              type='text'
              value={linkJustification}
              onChange={(e) => setLinkJustification(e.target.value)}
              placeholder='Ex.: Pagamento com juros; valor diferente por encargos.'
              autoComplete='off'
            />
          </div>
          <DialogFooter className='px-6 pb-6 pt-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => {
                setLinkDialogOpen(false);
                setLinkExtratoLineId(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              type='button'
              disabled={
                manualMatchMutation.isPending
                || !pickSuggestionForLinkId
                || !linkExtratoLineId
                || linkJustification.trim().length < 3
              }
              onClick={() => {
                if (!pickSuggestionForLinkId || !linkExtratoLineId) return;
                manualMatchMutation.mutate({
                  extratoLineId: linkExtratoLineId,
                  suggestionId: pickSuggestionForLinkId,
                  justification: linkJustification.trim(),
                });
              }}
            >
              {manualMatchMutation.isPending ? <Loader2 className='size-4 animate-spin' /> : 'Confirmar vínculo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
