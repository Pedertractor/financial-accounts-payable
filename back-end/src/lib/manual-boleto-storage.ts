import { createHash } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { env } from '../env/index.js';
import { HttpError } from '../http/erros/index.js';

const UPLOAD_DIR_ABS = resolve(process.cwd(), env.UPLOAD_DIR);

const MANUAL_BOLETO_PREFIX = 'manual-boleto' as const;

/** Apenas imagens e PDF (conferência manual). */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

export function absPathFromRel(rel: string): string {
  if (rel.includes('..') || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) {
    throw new HttpError('Caminho de anexo inválido', 400);
  }
  return join(UPLOAD_DIR_ABS, rel);
}

const EXT_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export function extForMimetype(
  mimetype: string,
  originalFileName?: string | null,
): string {
  let m = mimetype.toLowerCase().trim();
  if (originalFileName) {
    const e = extname(originalFileName).toLowerCase();
    if (m === '' || m === 'application/octet-stream') {
      const fromExt = EXT_TO_MIME[e];
      if (fromExt) {
        m = fromExt;
      }
    }
  }
  const ext = MIME_TO_EXT[m];
  if (!ext) {
    throw new HttpError(
      'Formato não suportado. Envie apenas imagem (JPEG, PNG, WebP, GIF) ou PDF.',
      400,
    );
  }
  return ext;
}

/**
 * Grava imagem ou PDF em `manual-boleto/{suggestionId}/{hash}{ext}` e retorna o caminho relativo a `UPLOAD_DIR`.
 */
export async function saveManualBoletoEvidence(params: {
  suggestionId: string;
  buffer: Buffer;
  mimetype: string;
  originalFileName?: string | null;
}): Promise<string> {
  if (params.buffer.length > env.MAX_UPLOAD_BYTES) {
    throw new HttpError(
      `Arquivo excede o tamanho máximo de ${env.MAX_UPLOAD_BYTES} bytes`,
      413,
    );
  }
  const ext = extForMimetype(params.mimetype, params.originalFileName);
  const base = join(
    UPLOAD_DIR_ABS,
    MANUAL_BOLETO_PREFIX,
    params.suggestionId,
  );
  await mkdir(base, { recursive: true });
  const short = createHash('sha256')
    .update(params.buffer)
    .digest('hex')
    .slice(0, 16);
  const fileName = `${short}${ext}`;
  const full = join(base, fileName);
  const rel = [MANUAL_BOLETO_PREFIX, params.suggestionId, fileName].join('/');
  await writeFile(full, params.buffer);
  return rel;
}

export async function removeManualBoletoEvidenceIfExists(
  relPath: string | null | undefined,
): Promise<void> {
  if (!relPath?.trim()) {
    return;
  }
  const abs = absPathFromRel(relPath.trim());
  try {
    await unlink(abs);
  } catch {
    // ignore
  }
}

export function contentTypeForRelPath(rel: string): string {
  const ext = (extname(rel) || '').toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

