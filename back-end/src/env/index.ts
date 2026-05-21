import z from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  DATABASE_URL: z.string(),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.string().default('3030'),
  JWT_SECRET: z.string(),
  APPNAME: z.string(),
  APPKEY: z.string(),
  API_PEDERTRACTOR_URL: z.string(),
  /** Diretório absoluto ou relativo à cwd para arquivos enviados na importação */
  UPLOAD_DIR: z.string().default('./uploads'),
  /** Tamanho máximo do arquivo (bytes). Padrão 10 MB. */
  MAX_UPLOAD_BYTES: z.coerce.number().int().default(10 * 1024 * 1024),
  /** Base URL do Orion (ex.: https://orion.exemplo.com), sem barra final. */
  ORION_URL: z.string().optional(),
  /** Token da app no Orion (formato uuid.secret), enviado como Bearer. */
  ORION_APP_TOKEN: z.string().optional(),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  const err = z.treeifyError(_env.error).properties;
  console.error('Variáveis de ambiente inválidas:', err);
  throw new Error('Variáveis de ambiente inválidas');
}

export const env = _env.data;
