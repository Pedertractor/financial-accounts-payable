const base =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ??
  'http://localhost:3030/api';

export function getApiBase(): string {
  return base;
}

/** Usado nas queryFns do React Query: aborta se o request demorar demais ou o componente desmontar. */
export function requestInitWithTimeout(
  querySignal: AbortSignal | undefined,
  timeoutMs: number,
): RequestInit {
  if (querySignal == null) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return { signal: AbortSignal.timeout(timeoutMs) };
    }
    return {};
  }
  if (
    typeof AbortSignal !== 'undefined' &&
    typeof AbortSignal.timeout === 'function' &&
    typeof AbortSignal.any === 'function'
  ) {
    return {
      signal: AbortSignal.any([querySignal, AbortSignal.timeout(timeoutMs)]),
    };
  }
  return { signal: querySignal };
}

export function getStoredToken(): string | null {
  return localStorage.getItem('reconcile_token');
}

export function authHeader(): Record<string, string> {
  const t = getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function apiJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const extra =
    init.headers && typeof init.headers === 'object'
      ? (init.headers as Record<string, string>)
      : {};
  const hasBody =
    init.body != null &&
    !(typeof init.body === 'string' && init.body.length === 0);
  const headers: Record<string, string> = {
    ...authHeader(),
    ...extra,
  };
  if (hasBody && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    headers,
  });
  const data = (await res.json().catch(() => ({}))) as
    | { error?: string }
    | T;
  if (!res.ok) {
    const msg =
      typeof (data as { error?: string }).error === 'string'
        ? (data as { error: string }).error
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export type PublicUser = {
  id: string;
  name: string;
  unit: string;
  cardNumber: string;
  role: string;
  active: boolean;
  firstLogin: boolean;
};

export async function loginRequest(body: {
  cardNumber: string;
  unit: 'PEDERTRACTOR' | 'TRACTOR';
  password: string;
}): Promise<{
  firstLoginRequired: boolean;
  token?: string;
  user: PublicUser;
}> {
  return apiJson<{
    firstLoginRequired: boolean;
    token?: string;
    user: PublicUser;
  }>('/users/login', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function completeFirstPasswordRequest(body: {
  userId: string;
  newPassword: string;
}): Promise<{
  firstLoginRequired: boolean;
  token: string;
  user: PublicUser;
}> {
  return apiJson<{
    firstLoginRequired: boolean;
    token: string;
    user: PublicUser;
  }>('/users/first-password', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export type FileUploadStatus = {
  id: string;
  runId: string | null;
  sourceType: string;
  status: string;
  originalFileName: string;
  fileSizeBytes: number | null;
  totalRowsDetected: number | null;
  totalRowsRead: number | null;
  totalRowsImported: number | null;
  totalRowsRejected: number | null;
  totalRowsWithWarnings: number | null;
  errorMessage: string | null;
  progressPercent: number;
  parsingStartedAt: string | null;
  finishedAt: string | null;
  needsUserConfirmation?: boolean;
  warningDetails?: { samples: { row: number; text: string }[] } | null;
};

export async function confirmStagedFileUpload(
  fileUploadId: string,
): Promise<{ fileUpload: FileUploadStatus }> {
  return apiJson(`/reconciliation/uploads/${fileUploadId}/confirm`, {
    method: 'POST',
  });
}

export async function cancelStagedFileUpload(
  fileUploadId: string,
): Promise<{ ok: boolean }> {
  return apiJson(`/reconciliation/uploads/${fileUploadId}/cancel`, {
    method: 'POST',
  });
}

/** Apaga do banco os lançamentos deste upload (banco ou interno) e marca o upload como cancelado. */
export async function deleteImportRecords(fileUploadId: string): Promise<void> {
  const res = await fetch(
    `${base}/reconciliation/uploads/${fileUploadId}/records`,
    {
      method: 'DELETE',
      headers: { ...authHeader() },
    },
  );
  if (res.status === 204) {
    return;
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  const msg =
    typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
  throw new Error(msg);
}

export type ReconciliationRunDto = {
  id: string
  title: string | null
  status: string
  unit: 'PEDERTRACTOR' | 'TRACTOR'
}

export async function createReconciliationRun(body: {
  title?: string
  unit: 'PEDERTRACTOR' | 'TRACTOR'
}): Promise<{ run: ReconciliationRunDto }> {
  return apiJson('/reconciliation/runs', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/** Verifica se a execução de conciliação ainda existe no servidor (evita 404 no upload com id antigo no storage). */
export async function getReconciliationRun(
  runId: string,
  init?: RequestInit,
): Promise<{ run: ReconciliationRunDto }> {
  return apiJson(`/reconciliation/runs/${runId}`, init);
}

/** Última execução do usuário para a empresa (reabre triagem sem reimportar). */
export async function getLatestReconciliationRun(
  params: { unit: 'PEDERTRACTOR' | 'TRACTOR' },
  init?: RequestInit,
): Promise<{ run: ReconciliationRunDto | null }> {
  const sp = new URLSearchParams()
  sp.set('unit', params.unit)
  return apiJson(`/reconciliation/runs/latest?${sp.toString()}`, init)
}

/**
 * Após importar banco e ERP, grava no banco as sugestões de vínculo e triagem.
 * (Não dispara automaticamente após cada arquivo.)
 */
export async function finalizeReconciliationRun(
  runId: string,
): Promise<{ created: number; message: string }> {
  return apiJson(`/reconciliation/runs/${runId}/finalize`, { method: 'POST' });
}

export type SuggestionListItem = {
  id: string
  triageBucket: string
  /** OPEN = pendente, APPROVED = conferido, etc. (persistido em `MatchSuggestion.status`) */
  suggestionStatus?: string
  /** Instante em que a sugestão foi conferida (APPROVED), se existir. */
  confirmedAt?: string | null
  /** Se o motivo permite confirmar com a tecla A (exato ou revisão). */
  canConfirm?: boolean
  /** @deprecated use suggestionStatus */
  status?: string
  reason: string
  /**
   * `revisao`: exibir categoria "Revisão" (nome aproximado, revisão manual ou só valor).
   * `padrao`: exibir o rótulo do motivo enum (exato, sem par, etc.).
   */
  reasonCategory?: 'revisao' | 'padrao'
  scorePercent: number
  amountDifference: string | null
  explanation: string | null
  amount: string | null
  /** Valor do lançamento banco (primeiro vinculado) */
  amountBank?: string | null
  /** Valor do lançamento interno/ERP (primeiro vinculado) */
  amountInternal?: string | null
  dueDate: string | null
  bankRecordIds: string[]
  internalRecordIds: string[]
  externalName: string
  internalName: string
  /** Aprovado como “sem par banco” vinculado a PIX ou TED. */
  paymentVinculoKind?: 'PIX' | 'TED' | null
  /** Cadastro em PIX & TED (mesmo fornecedor normalizado + tipo). */
  vinculoRegistry?: { id: string; hasDetails: boolean } | null
  /** Conta marcada como paga (persistido). */
  paidAt?: string | null
  /**
   * Só banco (sem par interno): há soma de 2+ títulos ERP que fecha o extrato.
   * Só ERP (sem par banco): este lançamento entra em alguma dessas somas que
   * fecha um extrato “só banco” na triagem.
   */
  sumAggregationAvailable?: boolean
  /** Detalhe de cada título ERP vinculado (motivo agregado, após confirmar). */
  aggregatedErpLines?: AggregatedErpLineDto[]
}

export type AggregatedErpLineDto = {
  id: string
  supplierNameRaw: string
  amount: string
  dueDate: string | null
  invoiceNumber: string | null
}

export type SuggestionListResponse = {
  run: ReconciliationRunDto
  filter: {
    compareDate: string | null
    compareEndDate: string | null
    statusFilter: 'todos' | 'pendente' | 'conferido' | 'pago'
  }
  summary: { total: number; pendente: number; conferido: number; pago: number }
  limit: number
  items: SuggestionListItem[]
}

export async function listRunSuggestions(
  runId: string,
  params?: {
    date?: string
    endDate?: string
    limit?: number
    statusFilter?: 'todos' | 'pendente' | 'conferido' | 'pago'
  },
  init?: RequestInit,
): Promise<SuggestionListResponse> {
  const sp = new URLSearchParams()
  if (params?.date) {
    sp.set('date', params.date)
  }
  if (params?.endDate && params.endDate !== params.date) {
    sp.set('endDate', params.endDate)
  }
  if (params?.limit != null) {
    sp.set('limit', String(params.limit))
  }
  if (params?.statusFilter && params.statusFilter !== 'todos') {
    sp.set('statusFilter', params.statusFilter)
  }
  const q = sp.toString()
  return apiJson(
    `/reconciliation/runs/${runId}/suggestions${q ? `?${q}` : ''}`,
    init,
  )
}

export type BankCandidateRow = {
  id: string
  beneficiaryNameRaw: string
  amount: string
  dueDate: string | null
  nameScore: number
  isCurrent: boolean
  pairedSuggestionId: string | null
  pairedStatus: string | null
}

export type InternalCandidateRow = {
  id: string
  supplierNameRaw: string
  amount: string
  dueDate: string | null
  invoiceNumber: string | null
  nameScore: number
  isCurrent: boolean
  pairedSuggestionId: string | null
  pairedStatus: string | null
}

export type SuggestionMultipleCandidatesResponse = {
  applicable: boolean
  matchKey: string | null
  nBanks: number
  nInternals: number
  currentInternalRecordId: string | null
  currentBankRecordId: string | null
  /** @deprecated use currentBankRecordId */
  bankRecordId: string | null
  /** Piso (%) de confiança de nome para exibir alternativas; o pareamento atual entra sempre. */
  minNameScoreCandidateList?: number
  /** Outros movimentos no mesmo valor/venc. ocultos por nota de nome abaixo do piso. */
  excludedLowNameSimilarity?: {
    bankRows: number
    internalRows: number
  }
  bankCandidates: BankCandidateRow[]
  internalCandidates: InternalCandidateRow[]
  /** @deprecated use internalCandidates */
  candidates: InternalCandidateRow[]
}

export async function getSuggestionMultipleCandidates(
  runId: string,
  suggestionId: string,
): Promise<SuggestionMultipleCandidatesResponse> {
  return apiJson(
    `/reconciliation/runs/${runId}/suggestions/${suggestionId}/candidates`,
  )
}

export async function resolveMultipleCandidateAndConfirm(
  runId: string,
  suggestionId: string,
  body: { internalRecordId: string; bankRecordId: string },
): Promise<{
  swapped: boolean
  suggestion: { id: string; status: string; confirmedAt: string | null }
}> {
  return apiJson(
    `/reconciliation/runs/${runId}/suggestions/${suggestionId}/resolve-candidate`,
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export type BankOnlySumInternalRow = {
  id: string
  supplierNameRaw: string
  amount: string
  dueDate: string | null
  invoiceNumber: string | null
  nameScore: number
  sourceSuggestionId: string
}

export type BankOnlySumCombination = {
  internalRecordIds: string[]
  avgNameScore: number
  internals: BankOnlySumInternalRow[]
}

export type BankOnlyManualPickRow = {
  id: string
  supplierNameRaw: string
  amount: string
  dueDate: string | null
  sourceSuggestionId: string
}

export type BankOnlyInternalSumResponse = {
  applicable: boolean
  targetAmount: string | null
  targetCents: number | null
  maxCandidatesConsidered: number
  /** Total de títulos internos elegíveis (valor da parcela ≤ extrato), antes do truncamento. */
  totalEligible?: number
  /**
   * per_line: todos os títulos da combinação têm nome plausível vs. o extrato;
   * amount_only: só bateu o valor (revisar nomes antes de vincular).
   */
  nameMatch?: 'per_line' | 'amount_only' | null
  /**
   * Títulos ainda "SEM PAR BANCO" (só interno) para vincular manualmente ao extrato.
   */
  manualPool?: BankOnlyManualPickRow[]
  bankRecordId: string | null
  bankRecord: {
    id: string
    beneficiaryNameRaw: string
    amount: string
    dueDate: string | null
  } | null
  combinations: BankOnlySumCombination[]
}

export async function getBankOnlyInternalSumCandidates(
  runId: string,
  suggestionId: string,
  signal?: AbortSignal,
): Promise<BankOnlyInternalSumResponse> {
  return apiJson<BankOnlyInternalSumResponse>(
    `/reconciliation/runs/${runId}/suggestions/${suggestionId}/bank-only-internal-sums`,
    { signal },
  )
}

export async function resolveBankOnlyInternalSum(
  runId: string,
  suggestionId: string,
  body: { internalRecordIds: string[] },
): Promise<{
  suggestion: { id: string; status: string; confirmedAt: string | null }
}> {
  return apiJson(
    `/reconciliation/runs/${runId}/suggestions/${suggestionId}/resolve-bank-only-internal-sum`,
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export async function confirmSuggestion(
  runId: string,
  suggestionId: string,
): Promise<{
  suggestion: { id: string; status: string; confirmedAt: string | null }
}> {
  return apiJson(
    `/reconciliation/runs/${runId}/suggestions/${suggestionId}/confirm`,
    { method: 'POST' },
  )
}

export async function confirmSuggestionsBatch(
  runId: string,
  ids: string[],
): Promise<{ confirmed: number; skipped: number }> {
  return apiJson(`/reconciliation/runs/${runId}/suggestions/confirm-batch`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
}

export async function linkPaymentVinculo(
  runId: string,
  suggestionId: string,
  body: { kind: 'PIX' | 'TED' },
): Promise<{
  suggestion: { id: string; status: string; confirmedAt: string | null }
}> {
  return apiJson(
    `/reconciliation/runs/${runId}/suggestions/${suggestionId}/link-payment`,
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export async function markSuggestionPaid(
  runId: string,
  suggestionId: string,
): Promise<{
  suggestion: { id: string; status: string; paidAt: string | null }
}> {
  return apiJson(
    `/reconciliation/runs/${runId}/suggestions/${suggestionId}/mark-paid`,
    { method: 'POST' },
  )
}

export type PaymentVinculoNameListItem = {
  id: string
  kind: 'PIX' | 'TED'
  displayName: string
  normalizedName: string
  registroNome: string | null
  userCode: string | null
  pixChave: string | null
  tedBanco: string | null
  tedAgencia: string | null
  tedConta: string | null
  tedCnpj: string | null
  hasDetails: boolean
  createdAt: string
  updatedAt: string
}

export type ListPaymentVinculoNamesResponse = {
  items: PaymentVinculoNameListItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function listPaymentVinculoNames(
  params?: { page?: number; pageSize?: number },
): Promise<ListPaymentVinculoNamesResponse> {
  const sp = new URLSearchParams()
  if (params?.page != null) {
    sp.set('page', String(params.page))
  }
  if (params?.pageSize != null) {
    sp.set('pageSize', String(params.pageSize))
  }
  const q = sp.toString()
  return apiJson(`/reconciliation/payment-vinculo-names${q ? `?${q}` : ''}`)
}

export async function getPaymentVinculoById(
  id: string,
): Promise<{ vinculo: PaymentVinculoNameListItem }> {
  return apiJson(`/reconciliation/payment-vinculo-names/${id}`)
}

export type UpdatePaymentVinculoBody = {
  registroNome?: string | null
  userCode?: string | null
  pixChave?: string | null
  tedBanco?: string | null
  tedAgencia?: string | null
  tedConta?: string | null
  tedCnpj?: string | null
}

export async function putPaymentVinculoById(
  id: string,
  body: UpdatePaymentVinculoBody,
): Promise<{ vinculo: PaymentVinculoNameListItem }> {
  return apiJson(`/reconciliation/payment-vinculo-names/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export type PaymentInstructionResponse = {
  kind: 'PIX' | 'TED'
  amount: string
  amountFormatted: string
  dueDate: string | null
  hasRegistryDetails: boolean
  vinculo: PaymentVinculoNameListItem | null
  paidAt: string | null
}

export async function getPaymentVinculoInstruction(
  runId: string,
  suggestionId: string,
): Promise<PaymentInstructionResponse> {
  return apiJson(
    `/reconciliation/runs/${runId}/suggestions/${suggestionId}/payment-instruction`,
  )
}

export async function getFileUpload(
  fileUploadId: string,
): Promise<{ fileUpload: FileUploadStatus }> {
  return apiJson(`/reconciliation/uploads/${fileUploadId}`);
}

const RECENT_UPLOADS_PATH = '/reconciliation/uploads';

export async function listRecentFileUploads(params?: {
  limit?: number;
}): Promise<{ uploads: FileUploadStatus[] }> {
  const sp = new URLSearchParams();
  if (params?.limit != null) {
    sp.set('limit', String(params.limit));
  }
  const q = sp.toString();
  return apiJson(`${RECENT_UPLOADS_PATH}${q ? `?${q}` : ''}`);
}

/**
 * Envia arquivo com acompanhamento de progresso do upload (0–100).
 * Retorna o id do registro e o cliente deve fazer poll do processamento.
 */
export function uploadReconciliationFile(
  runId: string,
  kind: 'bank' | 'internal',
  file: File,
  onUploadProgress: (percent: number) => void,
): Promise<{ fileUploadId: string; message: string }> {
  return new Promise((resolve, reject) => {
    const t = getStoredToken();
    if (!t) {
      reject(new Error('Não autenticado'));
      return;
    }
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', file);
    const path =
      kind === 'bank'
        ? `${base}/reconciliation/runs/${runId}/uploads/bank`
        : `${base}/reconciliation/runs/${runId}/uploads/internal`;
    xhr.open('POST', path);
    xhr.setRequestHeader('Authorization', `Bearer ${t}`);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        onUploadProgress(
          Math.min(100, Math.round((100 * ev.loaded) / ev.total)),
        );
      } else {
        onUploadProgress(0);
      }
    };
    xhr.onerror = () => reject(new Error('Falha de rede no upload'));
    xhr.onload = () => {
      try {
        const body = JSON.parse(
          xhr.responseText || '{}',
        ) as { fileUploadId?: string; error?: string; message?: string };
        if (xhr.status >= 200 && xhr.status < 300) {
          if (body.fileUploadId) {
            resolve({ fileUploadId: body.fileUploadId, message: body.message ?? '' });
          } else {
            reject(new Error('Resposta de upload inesperada'));
          }
        } else {
          reject(
            new Error(
              (typeof body.error === 'string' && body.error) || `HTTP ${xhr.status}`,
            ),
          );
        }
      } catch (e) {
        reject(
          e instanceof Error ? e : new Error('Resposta de upload inválida'),
        );
      }
    };
    xhr.send(form);
  });
}

export async function pollFileUpload(
  fileUploadId: string,
  onStatus: (u: FileUploadStatus) => void,
  intervalMs = 500,
): Promise<FileUploadStatus> {
  const terminal = new Set([
    'COMPLETED',
    'FAILED',
    'PARTIAL_SUCCESS',
    'AWAITING_CONFIRM',
  ]);
  for (;;) {
    const { fileUpload: u } = await getFileUpload(fileUploadId);
    onStatus(u);
    if (terminal.has(u.status)) {
      return u;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
