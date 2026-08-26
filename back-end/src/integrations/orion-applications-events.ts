import { env } from '../env/index.js';

export type OrionApplicationEventPayload = {
  userId: string;
  userName?: string;
  cardNumberUser?: string;
  ip: string;
  metadata?: unknown;
};

/** Um evento por usuário a cada 30 minutos, para evitar spam no Orion. */
export const ORION_EVENT_COOLDOWN_MS = 30 * 60 * 1000;

const lastSentAtByUserId = new Map<string, number>();

export function isOrionApplicationsConfigured(): boolean {
  return Boolean(env.ORION_URL?.trim() && env.ORION_APP_TOKEN?.trim());
}

export type SendOrionApplicationEventResult =
  | { kind: 'sent'; status: number }
  | { kind: 'failed'; status: number; body: string }
  | { kind: 'skipped' }
  | { kind: 'throttled' };

function pruneExpired(now: number) {
  for (const [userId, sentAt] of lastSentAtByUserId) {
    if (now - sentAt >= ORION_EVENT_COOLDOWN_MS) {
      lastSentAtByUserId.delete(userId);
    }
  }
}

function restoreLastSent(userId: string, previous: number | undefined) {
  if (previous === undefined) {
    lastSentAtByUserId.delete(userId);
    return;
  }
  lastSentAtByUserId.set(userId, previous);
}

export async function sendOrionApplicationEvent(
  payload: OrionApplicationEventPayload,
): Promise<SendOrionApplicationEventResult> {
  const base = env.ORION_URL?.trim();
  const token = env.ORION_APP_TOKEN?.trim();
  if (!base || !token) {
    return { kind: 'skipped' };
  }

  const now = Date.now();
  pruneExpired(now);

  const previous = lastSentAtByUserId.get(payload.userId);
  if (previous !== undefined && now - previous < ORION_EVENT_COOLDOWN_MS) {
    return { kind: 'throttled' };
  }

  lastSentAtByUserId.set(payload.userId, now);

  try {
    const url = `${base.replace(/\/$/, '')}/api/applications/events`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      restoreLastSent(payload.userId, previous);
      const body = await response.text();
      return { kind: 'failed', status: response.status, body };
    }

    return { kind: 'sent', status: response.status };
  } catch (err) {
    restoreLastSent(payload.userId, previous);
    throw err;
  }
}
