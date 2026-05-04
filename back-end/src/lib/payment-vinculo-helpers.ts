import {
  PaymentVinculoKind,
  SuggestionReason,
} from '../generated/prisma/enums.js';

export function paymentVinculoHasDetails(r: {
  kind: PaymentVinculoKind;
  pixChave: string | null;
  tedBanco: string | null;
  tedAgencia: string | null;
  tedConta: string | null;
  tedCnpj: string | null;
}): boolean {
  if (r.kind === PaymentVinculoKind.PIX) {
    return Boolean(r.pixChave?.trim());
  }
  return Boolean(
    r.tedBanco?.trim() &&
    r.tedAgencia?.trim() &&
    r.tedConta?.trim() &&
    r.tedCnpj?.trim(),
  );
}

export function vinculoKindFromSuggestion(s: {
  paymentVinculoKind: PaymentVinculoKind | null;
  reason: SuggestionReason;
}): PaymentVinculoKind | null {
  if (
    s.paymentVinculoKind === PaymentVinculoKind.PIX
    || s.paymentVinculoKind === PaymentVinculoKind.TED
    || s.paymentVinculoKind === PaymentVinculoKind.BOLETO
  ) {
    return s.paymentVinculoKind;
  }
  if (s.reason === SuggestionReason.PIX_CANDIDATE
    || s.reason === SuggestionReason.PIX_VINCULO_OK) {
    return PaymentVinculoKind.PIX;
  }
  if (s.reason === SuggestionReason.TED_CANDIDATE
    || s.reason === SuggestionReason.TED_VINCULO_OK) {
    return PaymentVinculoKind.TED;
  }
  if (s.reason === SuggestionReason.BOLETO_VINCULO_OK) {
    return PaymentVinculoKind.BOLETO;
  }
  return null;
}
