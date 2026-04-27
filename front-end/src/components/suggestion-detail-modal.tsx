import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { AlertTriangle, Landmark, Lightbulb, Loader2, QrCode, ScrollText } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  getSuggestionMultipleCandidates,
  linkPaymentVinculo,
  resolveMultipleCandidateAndConfirm,
  type SuggestionListItem,
} from "@/lib/api"
import { cn } from "@/lib/utils"

function formatBrlAmount(raw: string | null | undefined): string {
  if (raw == null || raw === "") {
    return "—"
  }
  const n = Number.parseFloat(raw)
  if (Number.isNaN(n)) {
    return raw
  }
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  })
}

function formatDatePt(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      return new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    }
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
  } catch {
    return "—"
  }
}

const REASON_LABEL: Record<string, string> = {
  EXACT_NAME_VALUE: "NOME E VALOR EXATOS",
  FUZZY_NAME_MATCH: "NOME APROXIMADO",
  VALUE_ONLY: "SÓ VALOR",
  MULTIPLE_CANDIDATES: "VÁRIOS CANDIDATOS",
  AGGREGATED_CANDIDATE: "AGREGADO",
  NO_INTERNAL_MATCH: "SEM PAR INTERNO",
  NO_BANK_MATCH: "SEM PAR BANCO",
  PIX_CANDIDATE: "PIX (SUGESTÃO)",
  TED_CANDIDATE: "TED (SUGESTÃO)",
  PIX_VINCULO_OK: "PIX",
  TED_VINCULO_OK: "TED",
  MANUAL_REVIEW_REQUIRED: "REVISÃO MANUAL",
}

const REASON_BADGE_STYLES: Record<
  string,
  { label: string; className: string }
> = {
  EXACT_NAME_VALUE: {
    label: "NOME E VALOR EXATOS",
    className: "text-emerald-800 dark:text-emerald-200 border-emerald-200/80",
  },
  FUZZY_NAME_MATCH: {
    label: "NOME APROXIMADO",
    className: "text-sky-800 dark:text-sky-200 border-sky-200/80",
  },
  VALUE_ONLY: {
    label: "SÓ VALOR",
    className: "text-emerald-800 dark:text-emerald-200 border-emerald-200/60",
  },
  MULTIPLE_CANDIDATES: {
    label: "VÁRIOS CANDIDATOS",
    className: "text-amber-900 dark:text-amber-200 border-amber-300/80",
  },
  AGGREGATED_CANDIDATE: {
    label: "AGREGADO",
    className: "text-violet-800 dark:text-violet-200 border-violet-200/60",
  },
  NO_INTERNAL_MATCH: {
    label: "SEM PAR INTERNO",
    className: "text-red-800 dark:text-red-200 border-rose-200/80",
  },
  NO_BANK_MATCH: {
    label: "SEM PAR BANCO",
    className: "text-red-800 dark:text-red-200 border-rose-200/80",
  },
  PIX_CANDIDATE: {
    label: "PIX (SUGESTÃO)",
    className: "text-teal-800 dark:text-teal-200 border-teal-200/80",
  },
  PIX_VINCULO_OK: {
    label: "PIX",
    className: "text-emerald-800 dark:text-emerald-200 border-emerald-200/80",
  },
  TED_CANDIDATE: {
    label: "TED (SUGESTÃO)",
    className: "text-cyan-800 dark:text-cyan-200 border-cyan-200/80",
  },
  TED_VINCULO_OK: {
    label: "TED",
    className: "text-sky-800 dark:text-sky-200 border-sky-200/80",
  },
  MANUAL_REVIEW_REQUIRED: {
    label: "REVISÃO MANUAL",
    className: "text-amber-900 dark:text-amber-200 border-amber-300/80",
  },
}

function getReasonCategory(
  r: SuggestionListItem
): "revisao" | "padrao" {
  if (r.reasonCategory === "revisao" || r.reasonCategory === "padrao") {
    return r.reasonCategory
  }
  return [
    "FUZZY_NAME_MATCH",
    "MANUAL_REVIEW_REQUIRED",
    "VALUE_ONLY",
  ].includes(r.reason)
    ? "revisao"
    : "padrao"
}

function MotivoReasonBadges({ row }: { row: SuggestionListItem }) {
  const categoria = getReasonCategory(row)
  const detalheLabel =
    REASON_BADGE_STYLES[row.reason]?.label ?? row.reason
  if (categoria === "revisao") {
    return (
      <div className="mb-1 flex min-h-8 flex-wrap items-end gap-2">
        <span className="text-muted-foreground text-[0.65rem] font-bold tracking-wider uppercase">
          Motivo / diferença
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="secondary"
            className="font-mono text-[0.65rem] tracking-tight border-amber-300/80 bg-amber-50 text-amber-950 dark:border-amber-800/50 dark:bg-amber-950/50 dark:text-amber-200"
          >
            Revisão
          </Badge>
          <span
            className="text-muted-foreground text-[0.6rem] font-mono"
            title={detalheLabel}
          >
            {detalheLabel}
          </span>
        </div>
        {row.amountDifference && row.amountDifference !== "0" ? (
          <span className="text-muted-foreground text-xs">
            Δ {formatBrlAmount(row.amountDifference)}
          </span>
        ) : null}
      </div>
    )
  }
  return (
    <div className="mb-1 flex min-h-8 flex-wrap items-end gap-2">
      <span className="text-muted-foreground text-[0.65rem] font-bold tracking-wider uppercase">
        Motivo / diferença
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="secondary"
          className={cn(
            "font-mono text-[0.65rem] font-medium tracking-tight",
            REASON_BADGE_STYLES[row.reason]?.className
          )}
        >
          {detalheLabel}
        </Badge>
        {row.amountDifference && row.amountDifference !== "0" ? (
          <span className="text-muted-foreground text-xs">
            Δ {formatBrlAmount(row.amountDifference)}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function hasBankData(r: SuggestionListItem): boolean {
  return r.bankRecordIds.length > 0
}

function hasInternalData(r: SuggestionListItem): boolean {
  return r.internalRecordIds.length > 0
}

function isSuggestionOpenState(r: SuggestionListItem): boolean {
  const st = r.suggestionStatus ?? r.status ?? "OPEN"
  return st === "OPEN"
}

function parseAmt(s: string | null | undefined): number | null {
  if (s == null || s === "") return null
  const n = Number.parseFloat(s)
  return Number.isNaN(n) ? null : n
}

function amountsDiffer(r: SuggestionListItem): boolean {
  const b = parseAmt(r.amountBank)
  const i = parseAmt(r.amountInternal)
  if (b == null && i == null) return false
  if (b == null || i == null) return true
  return Math.abs(b - i) > 0.0005
}

function namesDiffer(r: SuggestionListItem): boolean {
  if (!hasBankData(r) || !hasInternalData(r)) return false
  const a = r.externalName.replace(/\s+/g, " ").trim().toLowerCase()
  const b = r.internalName.replace(/\s+/g, " ").trim().toLowerCase()
  if (a === "—" || b === "—") return a !== b
  return a !== b
}

type OccurrenceLevel = "info" | "caution" | "critical"

function getOccurrenceLevel(r: SuggestionListItem): OccurrenceLevel {
  if (r.reason === "PIX_VINCULO_OK" || r.reason === "TED_VINCULO_OK") {
    return "info"
  }
  if (r.reason === "PIX_CANDIDATE" || r.reason === "TED_CANDIDATE") {
    return "caution"
  }
  if (
    r.reason === "NO_INTERNAL_MATCH" ||
    r.reason === "NO_BANK_MATCH"
  ) {
    return "critical"
  }
  if (
    r.reason === "MULTIPLE_CANDIDATES" ||
    r.reason === "MANUAL_REVIEW_REQUIRED" ||
    r.reason === "FUZZY_NAME_MATCH" ||
    r.reason === "VALUE_ONLY"
  ) {
    return "caution"
  }
  if (r.reason === "EXACT_NAME_VALUE" && r.scorePercent >= 80) {
    return "info"
  }
  return "caution"
}

function levelBadgeClass(level: OccurrenceLevel): string {
  if (level === "critical") {
    return "border-rose-300/80 bg-rose-50 text-rose-900 dark:border-rose-800/50 dark:bg-rose-950/50 dark:text-rose-200"
  }
  if (level === "caution") {
    return "border-amber-300/80 bg-amber-50 text-amber-950 dark:border-amber-800/50 dark:bg-amber-950/50 dark:text-amber-200"
  }
  return "border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200"
}

function levelLabelPt(level: OccurrenceLevel): string {
  if (level === "critical") return "Crítico"
  if (level === "caution") return "Atenção"
  return "Informativo"
}

type InlineToken = { type: "text"; t: string } | { type: "code"; t: string }

function interleaveNameTokens(
  bank: string,
  erp: string
): { parts: InlineToken[] } {
  return {
    parts: [
      { type: "text", t: "O nome no banco " },
      { type: "code", t: bank },
      { type: "text", t: " e o interno " },
      { type: "code", t: erp },
      {
        type: "text",
        t: " seriam esperados alinhados para o mesmo fornecedor.",
      },
    ],
  }
}

function buildAnalysisNarrative(r: SuggestionListItem): { parts: InlineToken[] } {
  const b = r.externalName
  const i = r.internalName
  if (r.reason === "MULTIPLE_CANDIDATES") {
    return {
      parts: [
        {
          type: "text",
          t: "Há mais de um lançamento bancário e/ou no ERP com o mesmo valor e vencimento. Selecione a linha do extrato e a do fornecedor desejados nas tabelas abaixo e confirme o vínculo. ",
        },
      ],
    }
  }
  if (r.reason === "EXACT_NAME_VALUE" && !amountsDiffer(r) && !namesDiffer(r)) {
    return {
      parts: [
        {
          type: "text",
          t: "A sugestão foi classificada como correspondência de nome e valor. Não foi detectada divergência entre banco e ERP para este item.",
        },
      ],
    }
  }
  if (r.reason === "NO_INTERNAL_MATCH") {
    return {
      parts: [
        {
          type: "text",
          t: "Foi localizado dado bancário (ex.: fornecedor ",
        },
        { type: "code", t: b || "—" },
        { type: "text", t: ") mas não existe lançamento interno/ERP associado a esta sugestão." },
      ],
    }
  }
  if (r.reason === "NO_BANK_MATCH") {
    return {
      parts: [
        { type: "text", t: "Há registro no ERP (ex.: " },
        { type: "code", t: i || "—" },
        { type: "text", t: ") sem movimento bancário correspondente na proposta de vínculo." },
      ],
    }
  }
  if (r.reason === "PIX_CANDIDATE") {
    return {
      parts: [
        {
          type: "text",
          t: "Este fornecedor já consta no cadastro de pagamentos via PIX. Confirme (A) se o título ainda for o mesmo padrão, ou ajuste a triagem.",
        },
      ],
    }
  }
  if (r.reason === "PIX_VINCULO_OK") {
    return {
      parts: [
        {
          type: "text",
          t: "Item aprovado como pagamento via PIX. O fornecedor permanece no cadastro para sugestões em execuções futuras.",
        },
      ],
    }
  }
  if (r.reason === "TED_CANDIDATE") {
    return {
      parts: [
        {
          type: "text",
          t: "Este fornecedor já consta no cadastro de pagamentos via TED. Confirme (A) se o título ainda for o mesmo padrão, ou ajuste a triagem.",
        },
      ],
    }
  }
  if (r.reason === "TED_VINCULO_OK") {
    return {
      parts: [
        {
          type: "text",
          t: "Item aprovado como pagamento via TED. O fornecedor permanece no cadastro para sugestões em execuções futuras.",
        },
      ],
    }
  }
  if (r.explanation && r.explanation.trim() !== "") {
    return { parts: [{ type: "text", t: r.explanation.trim() }] }
  }
  if (hasBankData(r) && hasInternalData(r)) {
    if (amountsDiffer(r) && namesDiffer(r)) {
      return {
        parts: [
          { type: "text", t: "Os nomes " },
          { type: "code", t: b },
          { type: "text", t: " (banco) e " },
          { type: "code", t: i },
          { type: "text", t: " (ERP) não coincidem literalmente, e os valores " },
          { type: "code", t: formatBrlAmount(r.amountBank) },
          { type: "text", t: " (banco) e " },
          { type: "code", t: formatBrlAmount(r.amountInternal) },
          { type: "text", t: " também divergem. Confirme se ainda trata do mesmo título." },
        ],
      }
    }
    if (namesDiffer(r)) {
      return interleaveNameTokens(b, i)
    }
    if (amountsDiffer(r)) {
      return {
        parts: [
          { type: "text", t: "Os valores banco " },
          { type: "code", t: formatBrlAmount(r.amountBank) },
          { type: "text", t: " e ERP " },
          { type: "code", t: formatBrlAmount(r.amountInternal) },
          { type: "text", t: " divergem; revisar se ainda se refere ao mesmo título." },
        ],
      }
    }
  }
  return {
    parts: [
      {
        type: "text",
        t: `Motivo registrado: ${REASON_LABEL[r.reason] ?? r.reason}.`,
      },
    ],
  }
}

function candidateSituation(
  isCurrent: boolean,
  pairedId: string | null,
  rowId: string
) {
  if (isCurrent) {
    return (
      <Badge variant="secondary" className="text-[0.6rem]">
        Pareamento atual
      </Badge>
    )
  }
  if (pairedId && pairedId !== rowId) {
    return (
      <span
        className="text-muted-foreground font-mono text-[0.65rem]"
        title={pairedId}
      >
        Em outra sugestão
      </span>
    )
  }
  return <span className="text-muted-foreground">—</span>
}

function MultipleCandidatesSection({
  runId,
  row,
  onResolved,
}: {
  runId: string
  row: SuggestionListItem
  onResolved?: () => void
}) {
  const st = row.suggestionStatus ?? row.status
  const isOpen = st === "OPEN" || st == null
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["suggestion-candidates", runId, row.id],
    queryFn: () => getSuggestionMultipleCandidates(runId, row.id),
    enabled: row.reason === "MULTIPLE_CANDIDATES" && isOpen,
  })
  const [selectedBankId, setSelectedBankId] = useState<string | null>(
    row.bankRecordIds[0] ?? null
  )
  const [selectedInternalId, setSelectedInternalId] = useState<string | null>(
    row.internalRecordIds[0] ?? null
  )
  useEffect(() => {
    setSelectedBankId(row.bankRecordIds[0] ?? null)
    setSelectedInternalId(row.internalRecordIds[0] ?? null)
  }, [row.id, row.bankRecordIds, row.internalRecordIds])

  const mutation = useMutation({
    mutationFn: (payload: { bankRecordId: string; internalRecordId: string }) =>
      resolveMultipleCandidateAndConfirm(runId, row.id, payload),
    onSuccess: () => {
      onResolved?.()
    },
  })
  const resolveErr =
    mutation.error instanceof Error ? mutation.error.message : null

  if (row.reason !== "MULTIPLE_CANDIDATES" || !isOpen) {
    return null
  }
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin" />
        Carregando candidatos…
      </div>
    )
  }
  if (isError) {
    return (
      <p className="text-destructive text-sm">
        {error instanceof Error ? error.message : "Erro ao carregar candidatos"}
      </p>
    )
  }
  const internalRows = data?.internalCandidates?.length
    ? data.internalCandidates
    : (data?.candidates ?? [])
  const bankRows = data?.bankCandidates?.length
    ? data.bankCandidates
    : []
  if (!data?.applicable || (internalRows.length === 0 && bankRows.length === 0)) {
    return null
  }

  return (
    <div className="space-y-3">
      <div className="text-muted-foreground flex items-center gap-2 text-[0.65rem] font-semibold tracking-wider uppercase">
        Candidatos (mesmo valor e vencimento)
      </div>
      <p className="text-muted-foreground text-xs">
        {data.nBanks} movimento(s) bancário(s) · {data.nInternals} interno(s) neste
        grupo. Escolha a linha do extrato bancário e a do fornecedor no ERP; trocas podem
        ajustar outra sugestão com o mesmo valor e vencimento.
        {data.excludedLowNameSimilarity != null
          && (data.excludedLowNameSimilarity.bankRows > 0
            || data.excludedLowNameSimilarity.internalRows > 0) ? (
          <span className="mt-1 block text-[0.7rem] leading-relaxed text-amber-900/90 dark:text-amber-200/90">
            Fora da lista:{" "}
            {data.excludedLowNameSimilarity.bankRows > 0 ? (
              <span>
                {data.excludedLowNameSimilarity.bankRows} no extrato
                {data.excludedLowNameSimilarity.internalRows > 0 ? ", " : ""}
              </span>
            ) : null}
            {data.excludedLowNameSimilarity.internalRows > 0 ? (
              <span>{data.excludedLowNameSimilarity.internalRows} no ERP</span>
            ) : null}{" "}
            (conf. nome abaixo de {data.minNameScoreCandidateList ?? 25}% em relação ao
            outro lado; não exibidos como alternativa plausível).
          </span>
        ) : null}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div
          className="border-border/60 min-w-0 rounded-lg border"
          role="radiogroup"
          aria-label="Escolher a linha do extrato bancário"
        >
          <p className="text-muted-foreground border-border/50 border-b px-3 py-2 text-[0.65rem] font-semibold tracking-wider uppercase">
            Extrato bancário
          </p>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-muted-foreground w-8 px-1 text-center text-xs" />
                <TableHead className="text-[0.65rem] uppercase">Nome (banco)</TableHead>
                <TableHead className="w-[4.5rem] text-[0.65rem] uppercase">
                  Conf. nome
                </TableHead>
                <TableHead className="min-w-20 text-[0.65rem] uppercase">
                  Situação
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bankRows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="w-8 px-1">
                    <input
                      type="checkbox"
                      className="border-input accent-primary size-3.5 cursor-pointer rounded border"
                      checked={selectedBankId === c.id}
                      onChange={() => {
                        setSelectedBankId(c.id)
                      }}
                      aria-label={`Selecionar extrato ${c.beneficiaryNameRaw}`}
                    />
                  </TableCell>
                  <TableCell className="text-foreground/90 min-w-0 text-sm wrap-anywhere">
                    {c.beneficiaryNameRaw}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{c.nameScore}%</TableCell>
                  <TableCell className="text-xs">
                    {candidateSituation(
                      c.isCurrent,
                      c.pairedSuggestionId,
                      row.id
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div
          className="border-border/60 min-w-0 rounded-lg border"
          role="radiogroup"
          aria-label="Escolher o fornecedor (ERP)"
        >
          <p className="text-muted-foreground border-border/50 border-b px-3 py-2 text-[0.65rem] font-semibold tracking-wider uppercase">
            ERP (fornecedor)
          </p>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-muted-foreground w-8 px-1 text-center text-xs" />
                <TableHead className="text-[0.65rem] uppercase">
                  Fornecedor
                </TableHead>
                <TableHead className="w-[4.5rem] text-[0.65rem] uppercase">
                  Conf. nome
                </TableHead>
                <TableHead className="min-w-20 text-[0.65rem] uppercase">
                  Situação
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {internalRows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="w-8 px-1">
                    <input
                      type="checkbox"
                      className="border-input accent-primary size-3.5 cursor-pointer rounded border"
                      checked={selectedInternalId === c.id}
                      onChange={() => {
                        setSelectedInternalId(c.id)
                      }}
                      aria-label={`Selecionar fornecedor ${c.supplierNameRaw}`}
                    />
                  </TableCell>
                  <TableCell className="text-foreground/90 min-w-0 text-sm wrap-anywhere">
                    {c.supplierNameRaw}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{c.nameScore}%</TableCell>
                  <TableCell className="text-xs">
                    {candidateSituation(
                      c.isCurrent,
                      c.pairedSuggestionId,
                      row.id
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Button
          type="button"
          disabled={
            !selectedBankId || !selectedInternalId || mutation.isPending
          }
          onClick={() => {
            if (selectedBankId && selectedInternalId) {
              mutation.mutate({
                bankRecordId: selectedBankId,
                internalRecordId: selectedInternalId,
              })
            }
          }}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Confirmando…
            </>
          ) : (
            "Confirmar vínculo e marcar como conferido"
          )}
        </Button>
        {resolveErr ? (
          <p className="text-destructive text-sm">{resolveErr}</p>
        ) : null}
      </div>
    </div>
  )
}

function LinkPaymentVinculoSection({
  runId,
  row,
  onResolved,
}: {
  runId: string
  row: SuggestionListItem
  onResolved?: () => void
}) {
  const queryClient = useQueryClient()
  const [pendingKind, setPendingKind] = useState<"PIX" | "TED" | null>(null)
  const mut = useMutation({
    mutationFn: (kind: "PIX" | "TED") =>
      linkPaymentVinculo(runId, row.id, { kind }),
    onMutate: (kind) => {
      setPendingKind(kind)
    },
    onSettled: () => {
      setPendingKind(null)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["payment-vinculo-names"] })
      onResolved?.()
    },
  })
  const err = mut.error instanceof Error ? mut.error.message : null
  return (
    <div className="flex flex-col items-stretch gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          className="h-9 gap-2"
          disabled={mut.isPending}
          onClick={() => {
            mut.mutate("PIX")
          }}
          aria-label="Vincular como PIX"
        >
          {mut.isPending && pendingKind === "PIX" ? (
            <Loader2 className="size-4 shrink-0 animate-spin" />
          ) : (
            <QrCode className="size-4 shrink-0" />
          )}
          Vincular PIX
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-9 gap-2"
          disabled={mut.isPending}
          onClick={() => {
            mut.mutate("TED")
          }}
          aria-label="Vincular como TED"
        >
          {mut.isPending && pendingKind === "TED" ? (
            <Loader2 className="size-4 shrink-0 animate-spin" />
          ) : (
            <Landmark className="size-4 shrink-0" />
          )}
          Vincular TED
        </Button>
      </div>
      {err != null && err.length > 0 ? (
        <p className="text-destructive text-right text-sm" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  )
}

function RawMetadataBlock({ r }: { r: SuggestionListItem }) {
  const payload: Record<
    string,
    string | string[] | number | boolean | null
  > = {
    suggestion_id: r.id,
    triage_bucket: r.triageBucket,
    reason: r.reason,
    score_percent: r.scorePercent,
    amount_difference: r.amountDifference,
    due_date: r.dueDate,
    bank_record_ids: r.bankRecordIds,
    internal_record_ids: r.internalRecordIds,
  }
  if (r.explanation) {
    payload.explanation = r.explanation
  }
  if (r.confirmedAt) {
    payload.confirmed_at = r.confirmedAt
  }
  if (r.paymentVinculoKind) {
    payload.payment_vinculo_kind = r.paymentVinculoKind
  }
  return (
    <div className="bg-muted/60 border-border/80 rounded-lg border p-3">
      <p className="text-muted-foreground mb-2 text-[0.65rem] font-semibold tracking-wider uppercase">
        Metadados brutos
      </p>
      <pre className="text-foreground/90 max-h-48 overflow-auto text-[0.72rem] leading-relaxed break-all whitespace-pre-wrap font-mono">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  )
}

function FieldBlock({
  label,
  value,
  warn,
  subCaption,
}: {
  label: string
  value: string
  warn?: boolean
  subCaption?: string
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        warn
          ? "border-amber-200/80 bg-amber-50/90 dark:border-amber-800/50 dark:bg-amber-950/30"
          : "border-border/80 bg-card"
      )}
    >
      <p className="text-muted-foreground mb-1.5 text-[0.65rem] font-semibold tracking-wider uppercase">
        {label}
      </p>
      <div className="flex items-start gap-2">
        {warn ? (
          <AlertTriangle className="text-amber-600 dark:text-amber-400 mt-0.5 size-4 shrink-0" />
        ) : null}
        <p className="min-w-0 text-sm font-medium break-words">{value}</p>
      </div>
      {warn && subCaption ? (
        <p className="text-amber-800 dark:text-amber-200 mt-1.5 text-xs">
          {subCaption}
        </p>
      ) : null}
    </div>
  )
}

type SideCardProps = {
  kind: "bank" | "internal"
  r: SuggestionListItem
  nameWarn: boolean
  amountWarn: boolean
}

function SideCard({ kind, r, nameWarn, amountWarn }: SideCardProps) {
  const isBank = kind === "bank"
  const title = isBank ? "Extrato bancário" : "Registro interno (ERP)"
  const name = isBank ? r.externalName : r.internalName
  const amount = isBank ? r.amountBank : r.amountInternal
  const nameLabel = isBank ? "Nome no banco" : "Nome no ERP"
  const amountLabel = isBank ? "Valor (banco)" : "Valor (ERP)"
  return (
    <div className="border-border/80 flex min-w-0 flex-1 flex-col gap-3 rounded-lg border bg-white p-4 dark:bg-card">
      <h3 className="text-muted-foreground text-[0.7rem] font-bold tracking-wider uppercase">
        {title}
      </h3>
      <FieldBlock
        label={nameLabel}
        value={name}
        warn={nameWarn}
        subCaption={nameWarn ? "Possível divergência no pareamento de nomes" : undefined}
      />
      <FieldBlock
        label={amountLabel}
        value={formatBrlAmount(amount ?? null)}
        warn={amountWarn}
        subCaption={
          amountWarn ? "Valor banco e ERP não coincidem nesta sugestão" : undefined
        }
      />
      <div className="text-muted-foreground text-[0.65rem] font-medium uppercase">
        Data
      </div>
      <p className="text-foreground -mt-2 text-sm">
        {formatDatePt(r.dueDate)}
      </p>
    </div>
  )
}

function AnalysisCallout({ r }: { r: SuggestionListItem }) {
  const level = getOccurrenceLevel(r)
  const { parts } = buildAnalysisNarrative(r)
  return (
    <div className="bg-muted/50 border-border/60 flex gap-3 rounded-lg border p-3 sm:p-4">
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-md",
          level === "critical" && "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200",
          level === "caution" &&
            "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
          level === "info" && "bg-slate-200/80 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
        )}
      >
        <Lightbulb className="size-5" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground text-sm font-semibold">
            Análise da sugestão
          </span>
          <Badge
            variant="secondary"
            className={cn("font-mono text-[0.65rem] tracking-tight", levelBadgeClass(level))}
          >
            {levelLabelPt(level)}
          </Badge>
        </div>
        <p className="text-foreground/90 text-sm leading-relaxed">
          {parts.map((p, i) =>
            p.type === "code" ? (
              <code
                key={i}
                className="border-border bg-background text-foreground mx-0.5 inline rounded border px-1.5 py-0.5 font-mono text-[0.8rem] font-normal [overflow-wrap:anywhere]"
              >
                {p.t}
              </code>
            ) : (
              <span key={i}>{p.t}</span>
            )
          )}
        </p>
      </div>
    </div>
  )
}

function AuditLogTable({ r }: { r: SuggestionListItem }) {
  const reasonLabel = REASON_LABEL[r.reason] ?? r.reason
  return (
    <div className="mt-1 space-y-2">
      <div className="text-muted-foreground flex items-center gap-2 text-[0.65rem] font-semibold tracking-wider uppercase">
        <ScrollText className="size-3.5" />
        Rastreio de avaliação
      </div>
      <div className="border-border/60 rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 text-[0.65rem] uppercase">Referência</TableHead>
              <TableHead className="h-8 w-28 text-[0.65rem] uppercase">Etapa</TableHead>
              <TableHead className="h-8 text-[0.65rem] uppercase">Detalhe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground max-w-32 text-xs font-mono break-all">
                {r.dueDate ? formatDatePt(r.dueDate) : "—"}
              </TableCell>
              <TableCell className="w-28">
                <Badge variant="secondary" className="font-mono text-[0.6rem]">
                  {REASON_LABEL[r.reason] != null ? "Avaliado" : "Registro"}
                </Badge>
              </TableCell>
              <TableCell className="text-foreground/90 min-w-0 text-xs [overflow-wrap:anywhere]">
                Motivo: {reasonLabel}
                {r.scorePercent > 0 ? ` · confiança ${r.scorePercent}%` : null}
                {r.amountDifference && r.amountDifference !== "0" ? (
                  <span>
                    <br />
                    Diferença de valor: {formatBrlAmount(r.amountDifference)}
                  </span>
                ) : null}
              </TableCell>
            </TableRow>
            {r.triageBucket ? (
              <TableRow>
                <TableCell colSpan={2} className="text-muted-foreground text-xs">
                  Categoria de triagem
                </TableCell>
                <TableCell className="font-mono text-xs break-all">
                  {r.triageBucket}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export function SuggestionDetailModal({
  row,
  open,
  onOpenChange,
  line,
  runId,
  onResolved,
}: {
  row: SuggestionListItem | null
  open: boolean
  onOpenChange: (o: boolean) => void
  line: number | null
  runId?: string | null
  onResolved?: () => void
}) {
  if (row == null) {
    return null
  }

  const hBank = hasBankData(row)
  const hInt = hasInternalData(row)
  const both = hBank && hInt
  const nameW = both && namesDiffer(row)
  const amtW = both && amountsDiffer(row)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl gap-0 p-0"
        showCloseButton
      >
        <DialogHeader className="border-border/60 space-y-1 border-b p-4 pb-3 pr-12">
          <DialogTitle>
            Comparação banco × ERP
            {line != null ? (
              <span className="text-muted-foreground font-mono text-sm font-normal">
                {" "}
                (linha #{line})
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 p-4">
          <MotivoReasonBadges row={row} />
          {both ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <SideCard
                kind="bank"
                r={row}
                nameWarn={nameW}
                amountWarn={amtW}
              />
              <SideCard
                kind="internal"
                r={row}
                nameWarn={nameW}
                amountWarn={amtW}
              />
            </div>
          ) : (
            <div
              className={cn("flex w-full", !hBank !== !hInt && "sm:justify-center")}
            >
              {hBank ? (
                <div className="w-full sm:max-w-md">
                  <SideCard
                    kind="bank"
                    r={row}
                    nameWarn={false}
                    amountWarn={false}
                  />
                </div>
              ) : null}
              {hInt ? (
                <div className="w-full sm:max-w-md">
                  <SideCard
                    kind="internal"
                    r={row}
                    nameWarn={false}
                    amountWarn={false}
                  />
                </div>
              ) : null}
            </div>
          )}
          {!hBank && !hInt ? (
            <p className="text-muted-foreground text-center text-sm">
              Não há lançamentos bancários ou internos vinculados a esta sugestão.
            </p>
          ) : null}

          <AnalysisCallout r={row} />
          {runId && row.reason === "MULTIPLE_CANDIDATES" ? (
            <MultipleCandidatesSection
              runId={runId}
              row={row}
              onResolved={onResolved}
            />
          ) : null}
          {runId &&
            isSuggestionOpenState(row) &&
            row.reason === "NO_BANK_MATCH" &&
            hasInternalData(row) &&
            !hasBankData(row) ? (
            <LinkPaymentVinculoSection
              runId={runId}
              row={row}
              onResolved={onResolved}
            />
          ) : null}
          <RawMetadataBlock r={row} />
          <AuditLogTable r={row} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
