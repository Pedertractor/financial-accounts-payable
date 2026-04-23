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
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  const err = z.treeifyError(_env.error).properties;
  console.error('Variáveis de ambiente inválidas:', err);
  throw new Error('Variáveis de ambiente inválidas');
}

export const env = _env.data;
