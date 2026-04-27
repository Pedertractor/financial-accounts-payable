import { z } from 'zod'

const nonEmptyTrim = (message: string) =>
  z.string().refine((s) => s.trim().length > 0, { message })

/**
 * Alinhado ao `paymentVinculoHasDetails` no back-end: chave PIX obrigatória.
 */
export const pixVinculoFormSchema = z.object({
  userCode: z.string(),
  pixChave: nonEmptyTrim('Informe a chave PIX.'),
})

/**
 * Banco, agência, C/C e CNPJ obrigatórios (não vazios após trim).
 */
export const tedVinculoFormSchema = z.object({
  userCode: z.string(),
  tedBanco: nonEmptyTrim('Informe o banco.'),
  tedAgencia: nonEmptyTrim('Informe a agência.'),
  tedConta: nonEmptyTrim('Informe a conta corrente (C/C).'),
  tedCnpj: nonEmptyTrim('Informe o CNPJ.'),
})

export type PixVinculoFormValues = z.infer<typeof pixVinculoFormSchema>
export type TedVinculoFormValues = z.infer<typeof tedVinculoFormSchema>
