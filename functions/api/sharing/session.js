/**
 * Session Management Worker
 * - Create sessions with 2-hour fixed duration
 * - Get session info (owner, file list, expiration)
 * - End session (immediate cleanup)
 * Location: /api/sharing/session/*
 */
import {
  SESSION_DURATION_MS,
  isSessionExpired,
  loadSession,
  saveSession,
  deleteSessionData
} from '../../lib/sessionUtils';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, {
    status,
    headers: CORS_HEADERS,
  });
}

/**
 * Generate random session ID using Web Crypto API
 */
function generateSessionId() {
  const randomBytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .substring(0, 16);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return emptyResponse();
  }

  if (method === 'GET' && action === 'get') {
    return getSession(context);
  }

  if (method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  if (action === 'create') {
    return createSession(context);
  } else if (action === 'end') {
    return endSession(context);
  }

  return jsonResponse({ error: 'Invalid action' }, 400);
}

async function createSession(context) {
  const { env, request } = context;
  const { ownerDevice } = await request.json().catch(() => ({}));
  const sessionId = generateSessionId();
  const now = Date.now();
  const expiresAt = now + SESSION_DURATION_MS; // 2 hours

  const sessionData = {
    id: sessionId,
    ownerDevice: ownerDevice || 'unknown',
    createdAt: now,
    expiresAt,
    files: [],
    totalSize: 0,
    status: 'active'
  };

  await saveSession(env, sessionData);

  return jsonResponse(
    {
      sessionId,
      expiresAt,
      qrData: sessionId,
    },
    201
  );
}

async function getSession(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');

  if (!sessionId) {
    return jsonResponse({ error: 'Missing sessionId' }, 400);
  }

  try {
    const session = await loadSession(env, sessionId);
    if (!session) {
      return jsonResponse({ error: 'Session not found' }, 404);
    }

    if (isSessionExpired(session)) {
      await deleteSessionData(env, session);
      return jsonResponse({ error: 'Session expired' }, 410);
    }

    return jsonResponse(session);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

async function endSession(context) {
  const { env, request } = context;
  const { sessionId } = await request.json().catch(() => ({}));

  if (!sessionId) {
    return jsonResponse({ error: 'Missing sessionId' }, 400);
  }

  try {
    const session = await loadSession(env, sessionId);
    if (!session) {
      return jsonResponse({ error: 'Session not found' }, 404);
    }

    await deleteSessionData(env, session);
    return jsonResponse({ success: true, sessionId });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}