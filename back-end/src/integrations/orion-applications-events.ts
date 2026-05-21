import { env } from '../env/index.js';

export type OrionApplicationEventPayload = {
  userId: string;
  userName?: string;
  cardNumberUser?: string;
  ip: string;
  metadata?: unknown;
};

export function isOrionApplicationsConfigured(): boolean {
  return Boolean(env.ORION_URL?.trim() && env.ORION_APP_TOKEN?.trim());
}

export type SendOrionApplicationEventResult =
  | { kind: 'sent'; status: number }
  | { kind: 'failed'; status: number; body: string }
  | { kind: 'skipped' };

export async function sendOrionApplicationEvent(
  payload: OrionApplicationEventPayload,
): Promise<SendOrionApplicationEventResult> {
  const base = env.ORION_URL?.trim();
  const token = env.ORION_APP_TOKEN?.trim();
  if (!base || !token) {
    return { kind: 'skipped' };
  }

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
    const body = await response.text();
    return { kind: 'failed', status: response.status, body };
  }

  return { kind: 'sent', status: response.status };
}
