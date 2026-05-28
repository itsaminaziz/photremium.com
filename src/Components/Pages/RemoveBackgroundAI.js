import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import SEO from '../SEO/SEO';
import FAQ from '../FAQ/FAQ';
import MobileImportPopup from '../MobileImportPopup/MobileImportPopup';
import { useLanguage } from '../../context/LanguageContext';
import './RemoveBackground.css';

/* ─── helpers ─────────────────────────────────────────────────────────────── */
const fmtSize = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};
const getExt = (name) => (name.match(/\.([^.]+)$/)?.[1] || 'img').toUpperCase();

const MAX_IMAGES           = 3;
const REMOVE_BG_TIMEOUT_MS = 300_000;   // 5 min wall-clock limit per image
const POLL_INTERVAL_BASE   = 2_000;     // start at 2 s, cap at 8 s
const POLL_INTERVAL_MAX    = 8_000;
const API_ENDPOINT         = process.env.REACT_APP_REMOVE_BG_WORKER_URL || '/api/remove-bg';

const STATUS_CYCLES = {
  uploading: ['Preparing upload...', 'Securing transfer...', 'Uploading image...'],
  detecting: ['Detecting edges...', 'Mapping subject...', 'Isolating background...'],
  processing: ['Refining cutout...', 'Smoothing edges...', 'Optimizing details...'],
  finalizing: ['Generating PNG...', 'Final checks...', 'Packaging result...'],
};

const getAnimatedStatus = (stage, tick) => {
  const list = STATUS_CYCLES[stage] || STATUS_CYCLES.processing;
  return list[tick % list.length];
};

/* Load natural image dimensions */
const loadDimensions = (file) =>
  new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload  = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth,  h: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ w: 0, h: 0 }); };
    img.src = url;
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Read a human-readable error from any response shape */
const readErrorMessage = async (res) => {
  try {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const d = await res.json().catch(() => ({}));
      return d?.error || d?.message || 'Background removal failed. Please try again.';
    }
    const t = await res.text().catch(() => '');
    return t || 'Background removal failed. Please try again.';
  } catch {
    return 'Background removal failed. Please try again.';
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   cleanupTask — NEVER uses the image's AbortController signal.
   Uses its own independent AbortController with a hard 10-second cap so that
   a timed-out or aborted image request does NOT also abort the cleanup fetch.
   This is the fix for BUG 1: open-task slots were never freed after timeout.
──────────────────────────────────────────────────────────────────────────── */
const cleanupTask = async (task, server) => {
  if (!task || !server) return;
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 10_000);
  try {
    await fetch(
      `${API_ENDPOINT}?action=cleanup&task=${encodeURIComponent(task)}&server=${encodeURIComponent(server)}`,
      { signal: ctrl.signal },
    );
  } catch {
    // Best-effort — failures are intentionally swallowed.
  } finally {
    clearTimeout(tid);
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   isTaskTerminal — recognises ALL ILoveIMG success states.
   BUG 5 fix: 'TaskSuccessWithWarnings' was missing → poll loop ran forever.
──────────────────────────────────────────────────────────────────────────── */
const TERMINAL_STATUSES = new Set([
  'success', 'succeeded', 'done', 'completed', 'complete',
  'finished', 'tasksuccess', 'tasksuccesswithwarnings', 'ready',
]);

const isTaskTerminal = (data) => {
  const s = String(data?.status || data?.state || data?.task_status || '').trim().toLowerCase();
  return TERMINAL_STATUSES.has(s) ||
    Boolean(data?.download_url || data?.result?.download_url || data?.resultUrl);
};

const FAILED_STATUSES = new Set([
  'error', 'failed', 'fail', 'taskerror', 'cancelled', 'canceled', 'tasknotfound',
]);

const isTaskFailed = (data) => {
  const s = String(data?.status || data?.state || data?.task_status || '').trim().toLowerCase();
  return FAILED_STATUSES.has(s);
};

/* ─────────────────────────────────────────────────────────────────────────────
   callRemoveBgApi — the single async function that owns one image's lifecycle.

   Key fixes:
   • AbortController signal is NEVER forwarded to cleanupTask  (BUG 1)
   • isTaskTerminal now covers TaskSuccessWithWarnings           (BUG 5)
   • Polling uses capped exponential back-off                   (BUG 6)
   • AbortError inside download retry loop breaks immediately   (BUG 7)
   • Task/server refs are always available for finally-cleanup  (BUG 1, 3)
   • pollForResult has its own elapsed guard independent of
     the AbortController so both paths trigger cleanup          (BUG 3)
──────────────────────────────────────────────────────────────────────────── */
const callRemoveBgApi = async (file, onStage) => {
  // These are hoisted so the finally block can always call cleanupTask.
  let taskId  = null;
  let serverId = null;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), REMOVE_BG_TIMEOUT_MS);

  /* ── inner: poll until terminal or timeout ────────────────────────────── */
  const pollForResult = async (task, server) => {
    taskId   = task;
    serverId = server;

    const startedAt       = Date.now();
    let   transientFails  = 0;
    let   pollInterval    = POLL_INTERVAL_BASE;

    while (Date.now() - startedAt < REMOVE_BG_TIMEOUT_MS) {
      // Respect abort signal from the outer controller.
      if (controller.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      let statusRes;
      try {
        statusRes = await fetch(
          `${API_ENDPOINT}?action=status&task=${encodeURIComponent(task)}&server=${encodeURIComponent(server)}`,
          { signal: controller.signal },
        );
      } catch (err) {
        // AbortError → bail immediately; the finally block cleans up.
        if (err?.name === 'AbortError' || controller.signal.aborted) throw err;

        transientFails += 1;
        if (transientFails <= 3) {
          await sleep(Math.min(pollInterval * transientFails, POLL_INTERVAL_MAX));
          continue;
        }
        throw err;
      }

      if (!statusRes.ok) {
        // 5xx / 429 are transient — retry with back-off.
        if (statusRes.status >= 500 || statusRes.status === 429) {
          transientFails += 1;
          if (transientFails <= 3) {
            await sleep(Math.min(pollInterval * transientFails, POLL_INTERVAL_MAX));
            continue;
          }
        }
        const message = await readErrorMessage(statusRes);
        throw new Error(message);
      }

      transientFails = 0;
      const statusData = await statusRes.json().catch(() => ({}));

      if (isTaskFailed(statusData)) {
        // Task is in a terminal-failed state on the server; cleanup is done
        // server-side already but we call it anyway for belt-and-suspenders.
        throw new Error(statusData?.message || 'Background removal failed. Please try again.');
      }

      if (isTaskTerminal(statusData)) {
        onStage('finalizing');
        let lastDownloadErr = null;

        for (let attempt = 0; attempt < 3; attempt += 1) {
          // BUG 7 fix: AbortError must not be retried.
          if (controller.signal.aborted) break;

          try {
            const downloadRes = await fetch(
              `${API_ENDPOINT}?action=download&task=${encodeURIComponent(task)}&server=${encodeURIComponent(server)}`,
              { signal: controller.signal },
            );

            if (!downloadRes.ok) {
              throw new Error(await readErrorMessage(downloadRes));
            }

            const blob = await downloadRes.blob();
            if (!blob || blob.size === 0) throw new Error('Empty download response.');
            if (!blob.type.startsWith('image/')) throw new Error('Invalid response from background remover.');

            onStage('done');
            // Task deleted by the worker via ctx.waitUntil after download — no
            // client-side cleanup needed for the happy path.
            taskId   = null; // prevent double-cleanup in finally
            serverId = null;
            return blob;

          } catch (err) {
            // AbortError — don't retry, fall through to finally cleanup.
            if (err?.name === 'AbortError' || controller.signal.aborted) {
              lastDownloadErr = err;
              break;
            }
            lastDownloadErr = err;
            if (attempt < 2) {
              await sleep(POLL_INTERVAL_BASE);
            }
          }
        }

        throw lastDownloadErr || new Error('Download failed after 3 attempts.');
      }

      // Still processing — wait with capped back-off.
      onStage('processing');
      // Gradually slow down polling to reduce API load.
      pollInterval = Math.min(pollInterval + 500, POLL_INTERVAL_MAX);
      await sleep(pollInterval);
    }

    // Elapsed > REMOVE_BG_TIMEOUT_MS — outer timeout may not have fired yet.
    throw new Error('Background removal timed out. Please try again.');
  };

  /* ── main flow ─────────────────────────────────────────────────────────── */
  try {
    onStage('uploading');

    const formData = new FormData();
    formData.append('image', file, file.name);

    const res = await fetch(API_ENDPOINT, {
      method: 'POST',
      body  : formData,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(await readErrorMessage(res));
    }

    const contentType = res.headers.get('content-type') || '';

    // Worker returned the processed image directly (fast path — unlikely but supported).
    if (contentType.startsWith('image/')) {
      onStage('finalizing');
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) throw new Error('Invalid response from background remover.');
      onStage('done');
      return blob;
    }

    // Worker returned a task handle — switch to polling mode.
    if (contentType.includes('application/json')) {
      const data = await res.json().catch(() => ({}));

      if (data?.task && data?.server) {
        onStage('processing');
        return await pollForResult(data.task, data.server);
      }

      throw new Error(data?.error || data?.message || 'Background removal failed. Please try again.');
    }

    throw new Error('Unexpected response from background remover.');

  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Background removal timed out. Please try again.');
    }
    throw err;

  } finally {
    // Always clear the timeout — prevents the controller from firing after the
    // image is already done or errored.
    clearTimeout(timeoutId);

    // BUG 1 + 3 fix: cleanup uses its OWN signal, not the image's controller.
    // This runs even when controller.signal is already aborted.
    if (taskId && serverId) {
      // Non-blocking — don't await so the UI updates immediately.
      cleanupTask(taskId, serverId);
    }
  }
};

/* ============================================================================
                      REMOVE BACKGROUND IMAGE PAGE
============================================================================ */
const RemoveBackgroundAI = () => {
  const { t } = useLanguage();
  const location = useLocation();
  const [images, setImages] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [downloadMode, setDownloadMode] = useState('zip');
  const [downloading, setDownloading] = useState(false);
  const [viewMode, setViewMode] = useState('result');
  const [compareMode, setCompareMode] = useState(false);
  const [comparePos, setComparePos] = useState(50);
  const [limitError, setLimitError] = useState('');
  const [statusCycleIndex, setStatusCycleIndex] = useState(0);

  /* Refs */
  const fileInputRef              = useRef(null);
  const addFileInputRef           = useRef(null);
  const compareRef                = useRef(null);
  const compareDragging           = useRef(false);
  const didPrefillFromStateRef    = useRef(false);
  const dragDepthRef              = useRef(0);
  const isMountedRef              = useRef(true);   // BUG 8 fix: unmount guard
  const supportsPointerEvents     = typeof window !== 'undefined' && 'PointerEvent' in window;

  /* BUG 8 fix: track mount state so async callbacks don't setState after unmount */
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const selected       = images.find((i) => i.id === selectedId) || null;
  const totalSize      = images.reduce((s, i) => s + i.file.size, 0);
  const doneCount      = images.filter((i) => i.status === 'done').length;
  const processingCount = images.filter((i) => i.status === 'processing').length;
  const animatedStatus = selected?.status === 'processing'
    ? getAnimatedStatus(selected.stage, statusCycleIndex)
    : '';

  const stageLabel = (stage) => {
    switch (stage) {
      case 'uploading':   return t('removeBgAi.stageUploading');
      case 'detecting':   return t('removeBgAi.stageDetecting');
      case 'finalizing':  return t('removeBgAi.stageFinalizing');
      case 'done':        return t('removeBgAi.stageDone');
      default:            return t('removeBgAi.stageProcessing');
    }
  };

  useEffect(() => {
    if (processingCount === 0) {
      setStatusCycleIndex(0);
      return undefined;
    }
    const id = setInterval(() => {
      setStatusCycleIndex((prev) => prev + 1);
    }, 3000);
    return () => clearInterval(id);
  }, [processingCount]);

  /* beforeunload guard */
  useEffect(() => {
    const h = (e) => {
      if (images.length) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [images.length]);

  /* popstate guard */
  useEffect(() => {
    if (!images.length) return;
    const handler = () => {
      if (!window.confirm(t('common.unsavedEdits'))) {
        window.history.pushState(null, '', window.location.href);
      }
    };
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [images.length, t]);

  /* Hide footer when workspace is active */
  useEffect(() => {
    if (images.length > 0) {
      document.body.classList.add('rbg-workspace-active');
    } else {
      document.body.classList.remove('rbg-workspace-active');
    }
    return () => document.body.classList.remove('rbg-workspace-active');
  }, [images.length]);

  /* ── compare slider ────────────────────────────────────────────────────── */
  const setComparePosFromClientX = useCallback((clientX) => {
    if (!compareRef.current || typeof clientX !== 'number') return;
    const rect = compareRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setComparePos(pct);
  }, []);

  const getEventClientX = useCallback((e) => {
    if (typeof e.clientX === 'number') return e.clientX;
    if (e.touches?.[0])        return e.touches[0].clientX;
    if (e.changedTouches?.[0]) return e.changedTouches[0].clientX;
    return null;
  }, []);

  const onComparePointerDown = useCallback((e) => {
    compareDragging.current = true;
    setComparePosFromClientX(getEventClientX(e));
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [getEventClientX, setComparePosFromClientX]);

  const onComparePointerMove = useCallback((e) => {
    if (!compareDragging.current) return;
    setComparePosFromClientX(getEventClientX(e));
  }, [getEventClientX, setComparePosFromClientX]);

  const onComparePointerUp = useCallback((e) => {
    compareDragging.current = false;
    e.currentTarget?.releasePointerCapture?.(e.pointerId);
  }, []);

  const onCompareTouchStart = useCallback((e) => {
    if (supportsPointerEvents) return;
    compareDragging.current = true;
    setComparePosFromClientX(getEventClientX(e));
    e.preventDefault();
  }, [getEventClientX, setComparePosFromClientX, supportsPointerEvents]);

  const onCompareTouchMove = useCallback((e) => {
    if (supportsPointerEvents || !compareDragging.current) return;
    setComparePosFromClientX(getEventClientX(e));
    e.preventDefault();
  }, [getEventClientX, setComparePosFromClientX, supportsPointerEvents]);

  const onCompareTouchEnd = useCallback(() => { compareDragging.current = false; }, []);

  /* ── processImage ──────────────────────────────────────────────────────── */
  const processImage = useCallback(async (imgObj) => {
    // Guard: don't start if component has unmounted (BUG 8).
    if (!isMountedRef.current) return;

    setImages((prev) =>
      prev.map((i) => i.id === imgObj.id ? { ...i, status: 'processing', stage: 'uploading' } : i),
    );

    try {
      const resultBlob = await callRemoveBgApi(imgObj.file, (stage) => {
        // BUG 8 fix: only update state if still mounted.
        if (!isMountedRef.current) return;
        setImages((prev) =>
          prev.map((i) => i.id === imgObj.id ? { ...i, stage } : i),
        );
      });

      if (!isMountedRef.current) return;

      const resultUrl = URL.createObjectURL(resultBlob);
      setImages((prev) =>
        prev.map((i) =>
          i.id === imgObj.id
            ? { ...i, status: 'done', stage: 'done', resultUrl, resultBlob }
            : i,
        ),
      );
    } catch (err) {
      console.error('BG removal error:', err);
      if (!isMountedRef.current) return;
      setImages((prev) =>
        prev.map((i) =>
          i.id === imgObj.id
            // Ensure stage is reset to 'error' — never left on 'processing'
            // which would leave the spinner showing (original infinite-loader bug).
            ? { ...i, status: 'error', stage: 'error', errorMsg: err.message }
            : i,
        ),
      );
    }
  }, []);

  /* ── addFiles ─────────────────────────────────────────────────────────── */
  const addFiles = useCallback(async (files) => {
    const valid = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!valid.length) return;

    const remaining = Math.max(0, MAX_IMAGES - images.length);
    if (remaining <= 0) {
      setLimitError(t('removeBgAi.limitError').replace('{n}', MAX_IMAGES));
      return;
    }

    const selectedFiles = valid.slice(0, remaining);
    if (valid.length > remaining) {
      setLimitError(t('removeBgAi.limitError').replace('{n}', MAX_IMAGES));
    } else {
      setLimitError('');
    }

    const newImgs = await Promise.all(
      selectedFiles.map(async (file) => {
        const dims = await loadDimensions(file);
        return {
          id         : crypto.randomUUID(),
          file,
          preview    : URL.createObjectURL(file),
          origW      : dims.w,
          origH      : dims.h,
          status     : 'pending',
          stage      : 'pending',
          resultUrl  : null,
          resultBlob : null,
          errorMsg   : '',
        };
      }),
    );

    setImages((prev) => {
      const merged = [...prev, ...newImgs];
      if (prev.length === 0 && newImgs.length > 0) setSelectedId(newImgs[0].id);
      return merged;
    });

    // Process sequentially — each image waits for the previous to finish so
    // we don't open multiple ILoveIMG tasks simultaneously (open-task limit).
    for (const imgObj of newImgs) {
      await processImage(imgObj);
    }
  }, [images.length, processImage, t]);

  /* prefill from Home paste popup */
  useEffect(() => {
    if (didPrefillFromStateRef.current) return;
    const incoming = location.state?.pastedImages;
    if (!Array.isArray(incoming) || incoming.length === 0) return;
    didPrefillFromStateRef.current = true;
    addFiles(incoming);
  }, [location.state, addFiles]);

  /* Ctrl+V paste */
  useEffect(() => {
    const handler = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files = [];
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) files.push(item.getAsFile());
      }
      if (files.length) { e.preventDefault(); addFiles(files); }
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [addFiles]);

  /* ── image list actions ────────────────────────────────────────────────── */
  const selectImage = (id) => {
    if (id === selectedId) return;
    setSelectedId(id);
    setViewMode('result');
    setCompareMode(false);
    setComparePos(50);
  };

  const removeImage = (id) => {
    const img = images.find((i) => i.id === id);
    if (img) {
      URL.revokeObjectURL(img.preview);
      if (img.resultUrl) URL.revokeObjectURL(img.resultUrl);
    }
    const remaining = images.filter((i) => i.id !== id);
    setImages(remaining);
    if (id === selectedId && remaining.length > 0) setSelectedId(remaining[0].id);
    if (remaining.length === 0) setSelectedId(null);
  };

  const retryImage = async (imgObj) => {
    await processImage(imgObj);
  };

  /* ── download ─────────────────────────────────────────────────────────── */
  const downloadSingle = async (imgObj) => {
    if (!imgObj?.resultBlob) return;
    const a        = document.createElement('a');
    a.href         = URL.createObjectURL(imgObj.resultBlob);
    const baseName = imgObj.file.name.replace(/\.[^.]+$/, '');
    a.download     = `${baseName}-nobg.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadAll = async () => {
    const doneImages = images.filter((i) => i.status === 'done' && i.resultBlob);
    if (!doneImages.length) return;
    setDownloading(true);
    try {
      if (doneImages.length === 1) {
        await downloadSingle(doneImages[0]);
      } else if (downloadMode === 'zip') {
        if (!window.JSZip) {
          const s   = document.createElement('script');
          s.src     = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
          document.head.appendChild(s);
          await new Promise((r) => { s.onload = r; });
        }
        const zip = new window.JSZip();
        doneImages.forEach(({ file, resultBlob }) => {
          zip.file(`${file.name.replace(/\.[^.]+$/, '')}-nobg.png`, resultBlob);
        });
        const content = await zip.generateAsync({ type: 'blob' });
        const a       = document.createElement('a');
        a.href        = URL.createObjectURL(content);
        a.download    = 'background-removed.zip';
        a.click();
        URL.revokeObjectURL(a.href);
      } else {
        for (const imgObj of doneImages) {
          await downloadSingle(imgObj);
          await sleep(300);
        }
      }
    } catch (err) {
      console.error('Download error:', err);
    }
    setDownloading(false);
  };

  /* start over */
  const handleStartOver = () => {
    if (!window.confirm(t('common.startOverConfirm'))) return;
    images.forEach((i) => {
      URL.revokeObjectURL(i.preview);
      if (i.resultUrl) URL.revokeObjectURL(i.resultUrl);
    });
    setImages([]);
    setSelectedId(null);
    setLimitError('');
  };

  /* ── drag & drop ──────────────────────────────────────────────────────── */
  const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

  const onDragEnter = (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragOver(true);
  };
  const onDragOver = (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
  };
  const onDragLeave = (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  };
  const onDrop = (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const getDisplayUrl = (imgObj) => {
    if (!imgObj) return '';
    if (viewMode === 'original') return imgObj.preview;
    if (imgObj.status === 'done' && imgObj.resultUrl) return imgObj.resultUrl;
    return imgObj.preview;
  };

  /* ======================================================================
                            UPLOAD VIEW
  ====================================================================== */
  if (!images.length) {
    return (
      <>
        <SEO
          title={t('removeBgAi.seo.uploadTitle')}
          description={t('removeBgAi.seo.uploadDesc')}
          keywords={t('removeBgAi.seo.uploadKeywords')}
        />
        <section className="rbg-upload">
          <div className="rbg-upload__inner">
            <h1 className="rbg-upload__title">{t('removeBgAi.title')}</h1>
            <p className="rbg-upload__desc">{t('removeBgAi.desc')}</p>

            <div
              className={`rbg-dropzone ${dragOver ? 'rbg-dropzone--active' : ''}`}
              onDragEnter={onDragEnter}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <div className="rbg-dropzone__cloud">
                <i className="fa-solid fa-cloud-arrow-up"></i>
              </div>
              <h3>{t('common.dropHere')}</h3>
              <p>
                {t('common.or')}{' '}
                <span className="rbg-dropzone__browse" onClick={() => fileInputRef.current?.click()}>
                  {t('common.browseFiles')}
                </span>{' '}
                {t('removeBgAi.toRemoveBg')}
              </p>
              <p className="rbg-dropzone__hint">
                <i className="fa-regular fa-keyboard"></i> {t('common.pasteHint')} <kbd>Ctrl</kbd> + <kbd>V</kbd>
              </p>
              {limitError && <p className="rbg-limit-error">{limitError}</p>}
              <div style={{ marginTop: 20, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <button className="rbg-dropzone__btn" onClick={() => fileInputRef.current?.click()} style={{ marginTop: 0 }}>
                  <i className="fa-solid fa-folder-open"></i> {t('common.chooseFiles')}
                </button>
                <MobileImportPopup onImportFiles={addFiles} />
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => addFiles(e.target.files)}
              />
            </div>
          </div>
        </section>

        <FAQ faqKey="removeBackground" />
      </>
    );
  }

  /* ======================================================================
                          WORKSPACE VIEW
  ====================================================================== */
  const isMulti = images.length > 1;

  return (
    <>
      <SEO
        title={t('removeBgAi.seo.workspaceTitle')}
        description={t('removeBgAi.seo.workspaceDesc')}
        keywords={t('removeBgAi.seo.workspaceKeywords')}
      />

      <section
        className={`rbg-workspace ${dragOver ? 'rbg-workspace--dragover' : ''}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* Mobile settings toggle */}
        <button
          className="rbg-settings-toggle"
          onClick={() => setMobileToolsOpen((p) => !p)}
          aria-label={t('common.toggleToolsPanel') || 'Toggle tools panel'}
        >
          <i className={mobileToolsOpen ? 'fa-solid fa-xmark' : 'fa-solid fa-gear'}></i>
        </button>

        {mobileToolsOpen && <div className="rbg-overlay" onClick={() => setMobileToolsOpen(false)} />}

        {/* ---------- PREVIEW PANEL (multi-image) ---------- */}
        {isMulti && (
          <div className="rbg-preview">
            <div className="rbg-preview__stat">
              <span className="rbg-preview__stat-value">{images.length} {t('common.images')}</span>
              <span className="rbg-preview__stat-label">{fmtSize(totalSize)}</span>
            </div>
            <div className="rbg-preview__list">
              {images.map((img) => (
                <div
                  key={img.id}
                  className={`rbg-preview__item ${img.id === selectedId ? 'rbg-preview__item--active' : ''}`}
                  onClick={() => selectImage(img.id)}
                >
                  <button
                    className="rbg-preview__remove"
                    onClick={(e) => { e.stopPropagation(); removeImage(img.id); }}
                    title={t('common.remove')}
                  >
                    <i className="fa-solid fa-xmark"></i>
                  </button>
                  <img
                    src={img.status === 'done' && img.resultUrl ? img.resultUrl : img.preview}
                    alt=""
                    draggable={false}
                  />
                  {img.status === 'processing' && (
                    <div className="rbg-preview__badge rbg-preview__badge--processing">
                      {stageLabel(img.stage)}
                    </div>
                  )}
                  {img.status === 'done' && (
                    <div className="rbg-preview__badge rbg-preview__badge--done">
                      {t('removeBgAi.badgeDone')}
                    </div>
                  )}
                  {img.status === 'error' && (
                    <div className="rbg-preview__badge rbg-preview__badge--error">
                      {t('removeBgAi.badgeError')}
                    </div>
                  )}
                  <div className="rbg-preview__meta">
                    <span className="rbg-preview__size">{fmtSize(img.file.size)}</span>
                    <span className="rbg-preview__type">{getExt(img.file.name)}</span>
                  </div>
                </div>
              ))}
              {images.length < MAX_IMAGES && (
                <div
                  className="rbg-preview__add"
                  onClick={() => addFileInputRef.current?.click()}
                  title={t('common.addMoreImages')}
                >
                  <i className="fa-solid fa-plus"></i>
                  <span>{t('common.addImage')}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---------- LEFT PANEL ---------- */}
        <div className="rbg-left">
          <div className="rbg-canvas-scroll">
            {selected && (
              <div className="rbg-canvas-wrap">
                {!compareMode && (
                  <div className={`rbg-canvas ${selected.status === 'done' && viewMode === 'result' ? 'rbg-canvas--transparent' : ''}`}>
                    <img src={getDisplayUrl(selected)} alt="" draggable={false} />
                    {selected.status === 'processing' && (
                      <div className="rbg-processing-overlay">
                        <div className="loader" aria-hidden="true" />
                        <div className="rbg-processing-text">
                          <span className="rbg-processing-stage">{stageLabel(selected.stage)}</span>
                          <span
                            key={`${selected.stage}-${statusCycleIndex}`}
                            className="rbg-processing-status"
                          >
                            {animatedStatus}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {selected.status === 'done' && compareMode && (
                  <div
                    className="rbg-compare-wrap"
                    ref={compareRef}
                    onPointerDown={onComparePointerDown}
                    onPointerMove={onComparePointerMove}
                    onPointerUp={onComparePointerUp}
                    onPointerCancel={onComparePointerUp}
                    onPointerLeave={onComparePointerUp}
                    onTouchStart={onCompareTouchStart}
                    onTouchMove={onCompareTouchMove}
                    onTouchEnd={onCompareTouchEnd}
                    onTouchCancel={onCompareTouchEnd}
                  >
                    <img src={selected.preview} alt="" draggable={false} />
                    <div className="rbg-compare__result" style={{ clipPath: `inset(0 0 0 ${comparePos}%)` }}>
                      <img src={selected.resultUrl} alt="" draggable={false} />
                    </div>
                    <div className="rbg-compare__line" style={{ left: `${comparePos}%` }}>
                      <div className="rbg-compare__handle">
                        <i className="fa-solid fa-chevron-left"></i>
                        <i className="fa-solid fa-chevron-right"></i>
                      </div>
                    </div>
                    <span className="rbg-compare__label rbg-compare__label--original">{t('common.original')}</span>
                    <span className="rbg-compare__label rbg-compare__label--result">{t('common.result')}</span>
                  </div>
                )}

                {selected.status === 'done' && (
                  <div className="rbg-toggle-view">
                    <button
                      className={`rbg-toggle-view__btn ${viewMode === 'result' && !compareMode ? 'active' : ''}`}
                      onClick={() => { setViewMode('result'); setCompareMode(false); }}
                    >
                      <i className="fa-solid fa-eraser"></i> {t('common.result')}
                    </button>
                    <button
                      className={`rbg-toggle-view__btn ${viewMode === 'original' && !compareMode ? 'active' : ''}`}
                      onClick={() => { setViewMode('original'); setCompareMode(false); }}
                    >
                      <i className="fa-solid fa-image"></i> {t('common.original')}
                    </button>
                    <button
                      className={`rbg-toggle-view__btn rbg-toggle-view__btn--compare ${compareMode ? 'active' : ''}`}
                      onClick={() => { setCompareMode((p) => !p); setComparePos(50); }}
                      title="Compare slider"
                    >
                      <i className="fa-solid fa-left-right"></i>
                    </button>
                  </div>
                )}

                {selected.status === 'error' && (
                  <button className="rbg-left__download" onClick={() => retryImage(selected)}>
                    <i className="fa-solid fa-rotate-right"></i> {t('removeBgAi.retry')}
                  </button>
                )}

                <div className="rbg-left__actions">
                  <button
                    className="rbg-left__download"
                    onClick={() => downloadSingle(selected)}
                    disabled={selected.status !== 'done'}
                  >
                    <i className="fa-solid fa-download"></i> {t('common.download')}
                  </button>
                  {isMulti && (
                    <button
                      className="rbg-left__next"
                      onClick={() => {
                        const idx     = images.findIndex((i) => i.id === selectedId);
                        const nextIdx = (idx + 1) % images.length;
                        selectImage(images[nextIdx].id);
                      }}
                    >
                      <i className="fa-solid fa-forward"></i> {t('removeBgAi.nextImage')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ---------- RIGHT PANEL ---------- */}
        <div className={`rbg-right ${mobileToolsOpen ? 'rbg-right--open' : ''}`}>
          <div className="rbg-right__sticky">
            <div className="rbg-right__header">
              <h3><i className="fa-solid fa-eraser"></i> {t('removeBgAi.backgroundRemover')}</h3>
              <button className="rbg-right__close" onClick={() => setMobileToolsOpen(false)} aria-label="Close panel">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="rbg-right__stats">
              <div className="rbg-stat">
                <span className="rbg-stat__label">{t('common.images')}</span>
                <span className="rbg-stat__value">{images.length}</span>
              </div>
              <div className="rbg-stat">
                <span className="rbg-stat__label">{t('common.size')}</span>
                <span className="rbg-stat__value">{fmtSize(totalSize)}</span>
              </div>
            </div>

            {limitError && <div className="rbg-limit-error">{limitError}</div>}

            {images.length > 0 && (
              <div className="rbg-right__progress">
                <span className="rbg-right__progress-label">{t('removeBgAi.processingProgress')}</span>
                <div className="rbg-progress-bar">
                  <div
                    className="rbg-progress-bar__fill"
                    style={{ width: `${images.length > 0 ? (doneCount / images.length) * 100 : 0}%` }}
                  />
                </div>
                <span className="rbg-right__progress-status">
                  {processingCount > 0
                    ? t('removeBgAi.processingNImages').replace('{n}', processingCount)
                    : doneCount === images.length
                    ? t('removeBgAi.allNProcessed').replace('{n}', doneCount)
                    : t('removeBgAi.nOfTotalDone').replace('{n}', doneCount).replace('{total}', images.length)}
                </span>
              </div>
            )}

            {selected && (
              <div className="rbg-right__info">
                <div className="rbg-info-row">
                  <span className="rbg-info-row__label">{t('removeBgAi.fileName')}</span>
                  <span className="rbg-info-row__value" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selected.file.name}
                  </span>
                </div>
                <div className="rbg-info-row">
                  <span className="rbg-info-row__label">{t('removeBgAi.dimensions')}</span>
                  <span className="rbg-info-row__value">{selected.origW} × {selected.origH}</span>
                </div>
                <div className="rbg-info-row">
                  <span className="rbg-info-row__label">{t('common.size')}</span>
                  <span className="rbg-info-row__value">{fmtSize(selected.file.size)}</span>
                </div>
                <div className="rbg-info-row">
                  <span className="rbg-info-row__label">{t('common.type')}</span>
                  <span className="rbg-info-row__value">{getExt(selected.file.name)}</span>
                </div>
                <div className="rbg-info-row">
                  <span className="rbg-info-row__label">{t('removeBgAi.status')}</span>
                  <span
                    className="rbg-info-row__value"
                    style={{
                      color:
                        selected.status === 'done'       ? '#10b981' :
                        selected.status === 'processing' ? '#f59e0b' :
                        selected.status === 'error'      ? '#ef4444' : '#94a3b8',
                    }}
                  >
                    {selected.status === 'done'       ? t('removeBgAi.statusDone')       :
                     selected.status === 'processing' ? stageLabel(selected.stage)        :
                     selected.status === 'error'      ? t('removeBgAi.statusError')       :
                                                        t('removeBgAi.statusPending')}
                  </span>
                </div>
              </div>
            )}

            {images.length < MAX_IMAGES && (
              <button className="rbg-right__add" onClick={() => addFileInputRef.current?.click()}>
                <i className="fa-solid fa-plus"></i> {t('common.addMoreImages')}
              </button>
            )}
            <input
              ref={addFileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
            />

            {images.length > 1 && (
              <div className="rbg-right__dl-mode">
                <label>{t('common.downloadAs')}:</label>
                <div className="rbg-dl-toggle">
                  <button
                    className={`rbg-dl-toggle__btn ${downloadMode === 'zip' ? 'active' : ''}`}
                    onClick={() => setDownloadMode('zip')}
                  >
                    <i className="fa-solid fa-file-zipper"></i> {t('common.zip')}
                  </button>
                  <button
                    className={`rbg-dl-toggle__btn ${downloadMode === 'separate' ? 'active' : ''}`}
                    onClick={() => setDownloadMode('separate')}
                  >
                    <i className="fa-regular fa-copy"></i> {t('common.separate')}
                  </button>
                </div>
              </div>
            )}

            <button className="rbg-right__reset" onClick={handleStartOver}>
              <i className="fa-solid fa-arrow-rotate-left"></i> {t('common.startOver')}
            </button>

            <div className="rbg-right__actions">
              <button
                className="rbg-right__download"
                onClick={downloadAll}
                disabled={downloading || doneCount === 0}
              >
                {downloading ? (
                  <>
                    <span className="rbg-download-spinner"></span>
                    {t('removeBgAi.downloading')}
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-download"></i>{' '}
                    {t('common.download')}{images.length > 1 ? ` ${t('converter.all')}` : ''}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default RemoveBackgroundAI;