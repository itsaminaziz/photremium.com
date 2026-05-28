/**
 * File Upload/Download Worker
 * - Presigned URL generation for direct R2 uploads/downloads
 * - Session metadata stored as a single KV record
 * Location: /api/sharing/files/*
 */

import { AwsClient } from 'aws4fetch';
import {
  STORAGE_LIMIT_BYTES,
  isSessionExpired,
  loadSession,
  saveSession,
  deleteSessionData,
  getStorageUsed,
  setStorageUsed,
  decrementStorageUsed,
  normalizeFilePath,
  encodeR2Key
} from '../../lib/sessionUtils';

const PRESIGN_TTL_SECONDS = 900; // 15 minutes

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
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

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  if (request.method === 'POST') {
    if (action === 'upload-url') {
      return handleUploadUrl(context);
    }
    if (action === 'complete') {
      return handleComplete(context);
    }
    if (action === 'abort') {
      return handleAbort(context);
    }
    return jsonResponse({ error: 'Invalid action' }, 400);
  } else if (request.method === 'GET') {
    if (action === 'download-url') {
      return handleDownloadUrl(context);
    }
    return jsonResponse({ error: 'Invalid action' }, 400);
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}

function getR2Config(env) {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucketName = env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error('Missing R2 S3 credentials or bucket configuration');
  }

  return { accountId, accessKeyId, secretAccessKey, bucketName };
}

async function createPresignedUrl(env, objectKey, method, contentType) {
  const { accountId, accessKeyId, secretAccessKey, bucketName } = getR2Config(env);
  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: 's3',
    region: 'auto'
  });

  const encodedKey = encodeR2Key(objectKey);
  const baseUrl = `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${encodedKey}`;
  const urlWithExpiry = `${baseUrl}?X-Amz-Expires=${PRESIGN_TTL_SECONDS}`;
  const headers = contentType ? { 'Content-Type': contentType } : undefined;
  const signedRequest = await client.sign(
    new Request(urlWithExpiry, { method, headers }),
    { aws: { signQuery: true } }
  );

  return signedRequest.url.toString();
}

async function handleUploadUrl(context) {
  const { env, request } = context;
  const body = await request.json().catch(() => ({}));
  const sessionId = body.sessionId;
  const fileName = body.fileName;
  const filePath = body.filePath;
  const fileSize = Number(body.fileSize || 0);
  const contentType = body.contentType || 'application/octet-stream';

  if (!sessionId || !fileName || !fileSize) {
    return jsonResponse({ error: 'Missing sessionId, fileName, or fileSize' }, 400);
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

    const normalizedPath = normalizeFilePath(filePath, fileName);
    const objectKey = `${sessionId}/${normalizedPath}`;
    const files = Array.isArray(session.files) ? session.files : [];

    if (files.some((file) => file.objectKey === objectKey)) {
      return jsonResponse({ error: 'File already exists in session' }, 409);
    }

    const storageUsed = await getStorageUsed(env);
    const proposedTotal = storageUsed + fileSize;
    if (proposedTotal >= STORAGE_LIMIT_BYTES) {
      return jsonResponse({ error: 'Storage limit reached', code: 'STORAGE_LIMIT' }, 413);
    }

    const uploadUrl = await createPresignedUrl(env, objectKey, 'PUT', contentType);

    session.files = files.concat({
      name: fileName,
      path: normalizedPath,
      size: fileSize,
      status: 'uploading',
      objectKey,
      contentType,
      createdAt: Date.now()
    });
    session.totalSize = (session.totalSize || 0) + fileSize;

    await setStorageUsed(env, proposedTotal);
    try {
      await saveSession(env, session);
    } catch (err) {
      await setStorageUsed(env, storageUsed);
      throw err;
    }

    return jsonResponse({
      uploadUrl,
      objectKey,
      contentType,
      expiresIn: PRESIGN_TTL_SECONDS
    });
  } catch (err) {
    console.error('Upload URL error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
}

async function handleComplete(context) {
  const { env, request } = context;
  const body = await request.json().catch(() => ({}));
  const sessionId = body.sessionId;
  const objectKey = body.objectKey;

  if (!sessionId || !objectKey) {
    return jsonResponse({ error: 'Missing sessionId or objectKey' }, 400);
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

    const files = Array.isArray(session.files) ? session.files : [];
    const file = files.find((entry) => entry.objectKey === objectKey);
    if (!file) {
      return jsonResponse({ error: 'File not found in session' }, 404);
    }

    file.status = 'complete';
    file.completedAt = Date.now();
    session.files = files;

    await saveSession(env, session);
    return jsonResponse({ success: true, objectKey });
  } catch (err) {
    console.error('Complete error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
}

async function handleAbort(context) {
  const { env, request } = context;
  const body = await request.json().catch(() => ({}));
  const sessionId = body.sessionId;
  const objectKey = body.objectKey;

  if (!sessionId || !objectKey) {
    return jsonResponse({ error: 'Missing sessionId or objectKey' }, 400);
  }

  try {
    const session = await loadSession(env, sessionId);
    if (!session) {
      return jsonResponse({ error: 'Session not found' }, 404);
    }

    const files = Array.isArray(session.files) ? session.files : [];
    const index = files.findIndex((entry) => entry.objectKey === objectKey);
    if (index === -1) {
      return jsonResponse({ error: 'File not found in session' }, 404);
    }

    const [removed] = files.splice(index, 1);
    session.files = files;
    session.totalSize = Math.max(0, (session.totalSize || 0) - (removed.size || 0));

    await env.IMAGE_BUCKET.delete(objectKey);
    await saveSession(env, session);
    await decrementStorageUsed(env, removed.size || 0);

    return jsonResponse({ success: true, objectKey });
  } catch (err) {
    console.error('Abort error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
}

async function handleDownloadUrl(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');
  const objectKey = url.searchParams.get('objectKey');

  if (!sessionId || !objectKey) {
    return jsonResponse({ error: 'Missing sessionId or objectKey' }, 400);
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

    const files = Array.isArray(session.files) ? session.files : [];
    const file = files.find((entry) => entry.objectKey === objectKey);
    if (!file) {
      return jsonResponse({ error: 'File not found in session' }, 404);
    }

    if (file.status !== 'complete') {
      return jsonResponse({ error: 'File not ready for download' }, 409);
    }

    const downloadUrl = await createPresignedUrl(env, objectKey, 'GET');
    return jsonResponse({ downloadUrl, objectKey, expiresIn: PRESIGN_TTL_SECONDS });
  } catch (err) {
    console.error('Download URL error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
}
