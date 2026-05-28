/**
 * ILoveIMG Background Removal — Cloudflare Worker
 * ─────────────────────────────────────────────────
 * Architecture: stateless fire-and-forget with client-driven polling.
 *
 * POST  /              → authenticate → start → upload → process
 *                        returns { task, server, status }  (HTTP 202)
 *
 * GET   ?action=status&task=…&server=…
 *                      → returns raw ILoveIMG task status JSON
 *
 * GET   ?action=download&task=…&server=…
 *                      → streams the processed image back, then queues
 *                        DELETE via waitUntil (guaranteed cleanup)
 *
 * GET   ?action=cleanup&task=…&server=…
 *                      → explicit DELETE for error/abort paths
 *
 * Key fixes vs original:
 *  1. Fresh JWT for every worker-→-ILoveIMG call (no stale token across
 *     async boundaries or between client polling hops).
 *  2. Download immediately triggers deleteTask via ctx.waitUntil so the
 *     open-task slot is freed before the next upload.
 *  3. Cleanup endpoint lets the client force-close orphaned tasks (network
 *     error, user cancels, etc.) — prevents open-task-limit exhaustion.
 *  4. Process step has a generous independent timeout; on timeout it still
 *     returns 202 so the client can poll status instead of hanging.
 *  5. All retries use exponential back-off with jitter.
 *  6. Every error path is typed and surfaced with a machine-readable
 *     `stage` field so client UI can show the right message.
 *  7. No shared mutable state — the isolate is truly stateless between
 *     requests; no global token cache, no global task references.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS   = 55_000;   // single upstream call ceiling
const PROCESS_TIMEOUT_MS = 50_000;   // process endpoint can be slow
const AUTH_TIMEOUT_MS    = 15_000;   // auth should be fast
const RETRY_ATTEMPTS     = 3;
const RETRY_BASE_DELAY   = 1_000;    // ms  (exponential: 1s, 2s, 4s)

// ─── CORS ─────────────────────────────────────────────────────────────────────

const CORS = {
  'access-control-allow-origin' : '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a JSON Response with CORS headers baked in. */
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...CORS,
      ...extra,
    },
  });

/** Strip surrounding whitespace and quotes from env values. */
const cleanKey = (v) => (v ?? '').trim().replace(/^["']+|["']+$/g, '');

/** SHA-1 hex digest (used for ILoveIMG signed-auth). */
const sha1 = async (str) => {
  const buf  = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Sleep with optional jitter (±20 %). */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (0.8 + Math.random() * 0.4)));

/** Read a response body as text regardless of Content-Type. */
const bodyText = async (res) => {
  try {
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const d = await res.json();
      return typeof d === 'string' ? d : JSON.stringify(d);
    }
    return (await res.text()).slice(0, 500);
  } catch {
    return '(unreadable body)';
  }
};

/**
 * fetch() with an AbortController timeout.
 * Throws a typed Error on timeout so callers can distinguish it.
 */
const timedFetch = async (url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) => {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      const e    = new Error(`Request timed out after ${timeoutMs / 1000}s: ${url}`);
      e.isTimeout = true;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(tid);
  }
};

/**
 * Retry wrapper with exponential back-off + jitter.
 * Non-retryable HTTP status codes (4xx except 429) surface immediately.
 */
const fetchWithRetry = async (url, init = {}, opts = {}) => {
  const attempts  = opts.attempts  ?? RETRY_ATTEMPTS;
  const baseDelay = opts.baseDelay ?? RETRY_BASE_DELAY;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;

  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await timedFetch(url, init, timeoutMs);

      // 4xx errors (except 429 rate-limit) are caller errors — don't retry.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return res;

      // 5xx / 429 — retry if attempts remain.
      if (!res.ok && i < attempts) {
        await sleep(baseDelay * 2 ** (i - 1));
        continue;
      }

      return res;
    } catch (err) {
      lastErr = err;
      if (i < attempts) await sleep(baseDelay * 2 ** (i - 1));
    }
  }
  throw lastErr;
};

// ─── Environment ──────────────────────────────────────────────────────────────

const getEnv = (env) => ({
  publicKey : cleanKey(env.ILOVEIMG_PUBLIC_KEY),
  secretKey : cleanKey(env.ILOVEIMG_SECRET_KEY),
  apiBase   : (env.ILOVEIMG_API_BASE ?? 'https://api.iloveimg.com/v1').replace(/\/$/, ''),
  region    : cleanKey(env.ILOVEIMG_REGION),
});

// ─── Authentication ───────────────────────────────────────────────────────────

/**
 * Obtain a short-lived JWT from ILoveIMG.
 * Tries plain public-key auth first; if that fails and a secret key is
 * configured it retries with two different HMAC-signature schemes that
 * ILoveIMG has used across API versions.
 *
 * Always called fresh — we never cache the token globally to avoid
 * cross-request token expiry issues.
 */
const authenticate = async ({ publicKey, secretKey, apiBase }) => {
  if (!publicKey) throw new Error('ILOVEIMG_PUBLIC_KEY is not configured.');

  const post = async (payload) => {
    const res = await fetchWithRetry(
      `${apiBase}/auth`,
      {
        method : 'POST',
        headers: {
          'content-type': 'application/json',
          'accept'      : 'application/json',
          'user-agent'  : 'cf-worker-remove-bg/2.0',
        },
        body: JSON.stringify(payload),
      },
      { attempts: 3, timeoutMs: AUTH_TIMEOUT_MS },
    );
    if (!res.ok) {
      const msg = await bodyText(res);
      throw Object.assign(new Error(`Auth failed (${res.status}): ${msg}`), { stage: 'auth', status: res.status });
    }
    const data = await res.json();
    if (!data?.token) throw Object.assign(new Error('Auth succeeded but token was missing.'), { stage: 'auth' });
    return data.token;
  };

  // Attempt 1 — public key only (works for most accounts).
  try {
    return await post({ public_key: publicKey });
  } catch (err) {
    if (!secretKey || err.status === 400) throw err; // misconfigured key
  }

  // Attempt 2 — signed auth (v1 scheme: sha1(secret + ts)).
  const ts  = Math.floor(Date.now() / 1000).toString();
  const sigA = await sha1(secretKey + ts);
  try {
    return await post({ public_key: publicKey, signature: sigA, timestamp: ts });
  } catch {
    // fall through to v2 scheme
  }

  // Attempt 3 — signed auth (v2 scheme: sha1(public + secret + ts)).
  const sigB = await sha1(publicKey + secretKey + ts);
  return await post({ public_key: publicKey, signature: sigB, timestamp: ts });
};

// ─── Task operations ──────────────────────────────────────────────────────────

/**
 * Start a new ILoveIMG task and return { server, task }.
 * A fresh token is obtained here so it is valid for the whole upload chain.
 */
const startTask = async (envCfg) => {
  const token   = await authenticate(envCfg);
  const { apiBase, region } = envCfg;
  const url     = region
    ? `${apiBase}/start/removebackgroundimage/${region}`
    : `${apiBase}/start/removebackgroundimage`;

  const res = await fetchWithRetry(url, {
    method : 'GET',
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
  });

  if (!res.ok) {
    const msg = await bodyText(res);
    throw Object.assign(new Error(`Start failed (${res.status}): ${msg}`), { stage: 'start' });
  }

  const data = await res.json();
  if (!data?.server || !data?.task) {
    throw Object.assign(new Error('Start response missing server/task fields.'), { stage: 'start' });
  }

  return { server: data.server, task: data.task, token };
};

/**
 * Upload a File/Blob to the assigned ILoveIMG worker server.
 * Returns the server_filename needed for the process call.
 */
const uploadFile = async ({ server, task, token }, file) => {
  const form = new FormData();
  form.append('task', task);
  form.append('file', file, file.name || 'image');

  const res = await fetchWithRetry(
    `https://${server}/v1/upload`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
  );

  if (!res.ok) {
    const msg = await bodyText(res);
    throw Object.assign(new Error(`Upload failed (${res.status}): ${msg}`), { stage: 'upload' });
  }

  const data = await res.json();
  if (!data?.server_filename) {
    throw Object.assign(new Error('Upload response missing server_filename.'), { stage: 'upload' });
  }

  return data.server_filename;
};

/**
 * Trigger background-removal processing.
 * Uses a separate (generous) timeout because this call can be slow.
 * On timeout it resolves gracefully — the task is still queued on ILoveIMG
 * and can be polled via the status endpoint.
 */
const processTask = async ({ server, task, token }, serverFilename, originalName) => {
  const payload = {
    task,
    tool : 'removebackgroundimage',
    files: [{ server_filename: serverFilename, filename: originalName || 'image' }],
  };

  let res;
  try {
    res = await timedFetch(
      `https://${server}/v1/process`,
      {
        method : 'POST',
        headers: {
          Authorization  : `Bearer ${token}`,
          'content-type' : 'application/json',
          accept         : 'application/json',
        },
        body: JSON.stringify(payload),
      },
      PROCESS_TIMEOUT_MS,
    );
  } catch (err) {
    // Timeout is fine — task is queued; client will poll.
    if (err.isTimeout) return { status: 'TaskProcessing', timedOut: true };
    throw Object.assign(err, { stage: 'process' });
  }

  // 5xx / 429 from the process endpoint — task may still be queued.
  if (res.status >= 500 || res.status === 429) {
    const msg = await bodyText(res);
    return { status: 'TaskProcessing', warning: `Process HTTP ${res.status}: ${msg}` };
  }

  if (!res.ok) {
    const msg = await bodyText(res);
    throw Object.assign(new Error(`Process failed (${res.status}): ${msg}`), { stage: 'process' });
  }

  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }

  return { status: data?.status ?? 'TaskProcessing' };
};

/**
 * Fetch task status from ILoveIMG.
 * Falls back to secret-key query-param auth if Bearer returns 401/403.
 */
const getTaskStatus = async (server, task, envCfg) => {
  const token     = await authenticate(envCfg);
  const secretKey = envCfg.secretKey;
  const baseUrl   = `https://${server}/v1/task/${task}`;

  let res = await timedFetch(baseUrl, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
  });

  if (!res.ok && (res.status === 401 || res.status === 403) && secretKey) {
    res = await timedFetch(`${baseUrl}?secret_key=${encodeURIComponent(secretKey)}`, {
      headers: { accept: 'application/json' },
    });
  }

  if (!res.ok) {
    const msg = await bodyText(res);
    throw Object.assign(new Error(`Status check failed (${res.status}): ${msg}`), { stage: 'status' });
  }

  return res.json();
};

/**
 * Download the processed image and stream it to the client.
 * After the response body is sent, queues a DELETE via ctx.waitUntil so
 * the open-task slot is freed immediately — even if the client disconnects.
 */
const downloadResult = async (server, task, envCfg, ctx) => {
  const token     = await authenticate(envCfg);
  const secretKey = envCfg.secretKey;

  const res = await timedFetch(`https://${server}/v1/download/${task}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const msg = await bodyText(res);
    throw Object.assign(new Error(`Download failed (${res.status}): ${msg}`), { stage: 'download' });
  }

  // Queue task deletion in background — MUST run even if client disconnects.
  if (ctx?.waitUntil) {
    ctx.waitUntil(deleteTask(server, task, envCfg));
  }

  const headers = new Headers(CORS);
  headers.set('content-type', res.headers.get('content-type') ?? 'image/png');
  headers.set('cache-control', 'no-store');
  headers.set('x-task-id', task); // useful for client-side logging

  return new Response(res.body, { status: 200, headers });
};

/**
 * DELETE a task on ILoveIMG to free the open-task slot.
 * This is fire-and-forget — failures are swallowed so they never block
 * the main response.  Called via ctx.waitUntil after every download.
 */
const deleteTask = async (server, task, envCfg) => {
  try {
    const token     = await authenticate(envCfg);
    const secretKey = envCfg.secretKey;

    // Prefer secret-key query-param variant (more reliable for cleanup).
    const url = secretKey
      ? `https://${server}/v1/task/${task}?secret_key=${encodeURIComponent(secretKey)}`
      : `https://${server}/v1/task/${task}`;

    await timedFetch(url, {
      method : 'DELETE',
      headers: secretKey ? {} : { Authorization: `Bearer ${token}`, accept: 'application/json' },
    }, 10_000);
  } catch {
    // Intentionally silent — cleanup failure must never surface to client.
  }
};

// ─── Request router ───────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {

    // ── Pre-flight ──────────────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const envCfg = getEnv(env);

    // Validate keys early so misconfiguration is obvious.
    if (!envCfg.publicKey) {
      return json({ error: 'ILOVEIMG_PUBLIC_KEY is not set in worker environment.', stage: 'config' }, 500);
    }

    const url    = new URL(request.url);
    const method = request.method.toUpperCase();

    // ── GET: status / download / cleanup ───────────────────────────────────
    if (method === 'GET') {
      const action = url.searchParams.get('action');
      const task   = url.searchParams.get('task');
      const server = url.searchParams.get('server');

      if (!action || !task || !server) {
        return json({ error: 'Missing required query params: action, task, server.', stage: 'params' }, 400);
      }

      try {
        // ── status ──────────────────────────────────────────────────────────
        if (action === 'status') {
          const data = await getTaskStatus(server, task, envCfg);
          return json(data);
        }

        // ── download ────────────────────────────────────────────────────────
        if (action === 'download') {
          return await downloadResult(server, task, envCfg, ctx);
        }

        // ── cleanup ─────────────────────────────────────────────────────────
        if (action === 'cleanup') {
          // Best-effort synchronous delete so the slot is freed immediately.
          await deleteTask(server, task, envCfg);
          return json({ ok: true, task });
        }

        return json({ error: `Unknown action: "${action}".`, stage: 'params' }, 400);

      } catch (err) {
        return json({
          error: err.message ?? 'Unexpected worker error.',
          stage: err.stage  ?? 'unknown',
        }, 500);
      }
    }

    // ── POST: start → upload → process ─────────────────────────────────────
    if (method !== 'POST') {
      return json({ error: 'Method not allowed.', stage: 'router' }, 405);
    }

    try {
      // Parse multipart form.
      let formData;
      try {
        formData = await request.formData();
      } catch (err) {
        return json({ error: `Could not parse form data: ${err.message}`, stage: 'parse' }, 400);
      }

      const image = formData.get('image');
      if (!image || typeof image === 'string') {
        return json({ error: 'Missing "image" file in form data.', stage: 'parse' }, 400);
      }

      // Validate file size (100 MB hard cap — Cloudflare Free/Pro limit).
      if (image.size > 100 * 1024 * 1024) {
        return json({ error: 'Image file exceeds 100 MB limit.', stage: 'parse' }, 413);
      }

      // Validate MIME type (accept common image formats).
      const mime = (image.type ?? '').toLowerCase();
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff'];
      if (mime && !allowed.includes(mime)) {
        return json({ error: `Unsupported image type "${mime}".`, stage: 'parse' }, 415);
      }

      // ── Step 1: Authenticate + Start task ──────────────────────────────
      const { server, task, token } = await startTask(envCfg);

      // ── Step 2: Upload ─────────────────────────────────────────────────
      const serverFilename = await uploadFile({ server, task, token }, image);

      // ── Step 3: Process ────────────────────────────────────────────────
      const { status, warning, timedOut } = await processTask(
        { server, task, token },
        serverFilename,
        image.name,
      );

      // Return task handle — client polls /status then calls /download.
      const body = { task, server, status };
      if (warning)  body.warning   = warning;
      if (timedOut) body.timedOut  = true;

      return json(body, 202);

    } catch (err) {
      return json({
        error: err.message ?? 'Unexpected worker error.',
        stage: err.stage  ?? 'worker',
      }, 500);
    }
  },
};