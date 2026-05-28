/**
 * Session Utilities
 * Shared logic for session management and storage counters
 */

export const SESSION_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours
export const STORAGE_LIMIT_BYTES = 10737418240; // 10GB hard limit
export const STORAGE_COUNTER_KEY = 'global:storage_used';

export function isSessionExpired(session) {
  return Date.now() > session.expiresAt;
}

export function getSessionKey(sessionId) {
  return `session:${sessionId}`;
}

export function normalizeFilePath(filePath, fallbackName) {
  const raw = (filePath || fallbackName || '').replace(/\\/g, '/');
  const trimmed = raw.replace(/^\/+/, '').trim();
  return trimmed || (fallbackName || 'file');
}

export function encodeR2Key(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

export async function loadSession(env, sessionId) {
  const raw = await env.SESSIONS.get(getSessionKey(sessionId));
  return raw ? JSON.parse(raw) : null;
}

export async function saveSession(env, session) {
  const expiration = Math.ceil(session.expiresAt / 1000);
  await env.SESSIONS.put(getSessionKey(session.id), JSON.stringify(session), {
    expiration
  });
}

export async function getStorageUsed(env) {
  const raw = await env.SESSIONS.get(STORAGE_COUNTER_KEY);
  const parsed = Number.parseInt(raw || '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function setStorageUsed(env, bytes) {
  const safeValue = Math.max(0, Math.floor(bytes));
  await env.SESSIONS.put(STORAGE_COUNTER_KEY, String(safeValue));
  return safeValue;
}

export async function incrementStorageUsed(env, bytes) {
  const current = await getStorageUsed(env);
  const next = current + Math.max(0, Math.floor(bytes));
  return setStorageUsed(env, next);
}

export async function decrementStorageUsed(env, bytes) {
  const current = await getStorageUsed(env);
  const next = current - Math.max(0, Math.floor(bytes));
  return setStorageUsed(env, next);
}

export async function deleteSessionData(env, session) {
  if (!session) return;

  const files = Array.isArray(session.files) ? session.files : [];
  for (const file of files) {
    if (file.objectKey) {
      await env.IMAGE_BUCKET.delete(file.objectKey);
    }
  }

  await env.SESSIONS.delete(getSessionKey(session.id));

  if (session.totalSize) {
    await decrementStorageUsed(env, session.totalSize);
  }
}
