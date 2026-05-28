import React, { useState, useCallback, useRef, useEffect } from 'react';
import QRCode from 'qrcode';
import './ImageSharing.css';

const TIMER_UPDATE_INTERVAL = 100; // Update timer every 100ms for smooth display
const STORAGE_LIMIT_MESSAGE = 'Your request could NOT be completed. Try later....';

const getSharingApiBase = () => {
  if (process.env.REACT_APP_SHARING_API_BASE) {
    return process.env.REACT_APP_SHARING_API_BASE.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'https://photremium.com';
  }
  return '';
};

// Utility to calculate remaining time in real-time
const calculateTimeRemaining = (expiresAt) => {
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) {
    return { expired: true, minutes: 0, seconds: 0, total: 0 };
  }
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return { expired: false, minutes, seconds, total: remaining };
};

// Broadcast Channel for cross-tab communication
let sharedChannel = null;
try {
  sharedChannel = new BroadcastChannel('image-sharing-session');
} catch (e) {
  console.log('BroadcastChannel not available, session sync may be limited');
}

const ImageSharing = () => {
  const [mode, setMode] = useState('loading'); // 'host', 'receiver', or 'loading'
  const [sessionId, setSessionId] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [qrCode, setQrCode] = useState(null);
  const [receiverLink, setReceiverLink] = useState(null);
  const [files, setFiles] = useState([]); // Host uploaded files
  const [receiverFiles, setReceiverFiles] = useState([]); // Receiver's view of files
  const [selectedFiles, setSelectedFiles] = useState(new Set()); // For multiple downloads
  const [uploadProgress, setUploadProgress] = useState({});
  const [totalProgress, setTotalProgress] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [currentlyUploading, setCurrentlyUploading] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState({ minutes: 120, seconds: 0 });
  const [showFilesDropdown, setShowFilesDropdown] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);

  const fileInputRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const uploadProgressRef = useRef({});
  const apiBase = getSharingApiBase();

  // Fetch files available in session for receiver
  const fetchReceiverFiles = useCallback(async (sessId) => {
    try {
      const response = await fetch(`${apiBase}/api/sharing/session?action=get&sessionId=${sessId}`);
      if (!response.ok) throw new Error('Failed to fetch session');

      const session = await response.json();
      setReceiverFiles(session.files || []);
      setExpiresAt(session.expiresAt);

      if (Date.now() > session.expiresAt && !sessionExpired) {
        setSessionExpired(true);
      }
    } catch (err) {
      console.error('Failed to fetch receiver files:', err);
    }
  }, [apiBase, sessionExpired]);

  // Create session
  const createSession = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${apiBase}/api/sharing/session?action=create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerDevice: 'web' })
      });

      if (!response.ok) {
        throw new Error(`Create session failed (${response.status})`);
      }

      const data = await response.json();
      const newExpiresAt = data.expiresAt;

      setSessionId(data.sessionId);
      setExpiresAt(newExpiresAt);

      // Generate QR code
      const qrDataUrl = await QRCode.toDataURL(data.sessionId, {
        errorCorrectionLevel: 'H',
        type: 'image/png',
        width: 300,
        margin: 1
      });
      setQrCode(qrDataUrl);

      // Generate receiver link
      const baseUrl = window.location.origin;
      const receiverLinkUrl = `${baseUrl}/image-sharing?join=${data.sessionId}`;
      setReceiverLink(receiverLinkUrl);

      setMode('host');
    } catch (err) {
      console.error('Session creation failed:', err);
      alert('Failed to create session');
    } finally {
      setIsLoading(false);
    }
  }, [apiBase]);

  // Timer update - update every 100ms for smooth real-time display
  useEffect(() => {
    if (!expiresAt) return;

    const updateTimer = () => {
      const time = calculateTimeRemaining(expiresAt);
      setTimeRemaining({ minutes: time.minutes, seconds: time.seconds });

      if (time.expired && !sessionExpired) {
        setSessionExpired(true);
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      }
    };

    updateTimer(); // Initial update
    timerIntervalRef.current = setInterval(updateTimer, TIMER_UPDATE_INTERVAL);

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [expiresAt, sessionExpired]);

  // Broadcast session to other tabs
  useEffect(() => {
    if (sessionId && sharedChannel) {
      sharedChannel.postMessage({
        type: 'SESSION_CREATED',
        sessionId,
        expiresAt,
        qrCode,
        receiverLink,
        mode
      });
    }
  }, [sessionId, expiresAt, qrCode, receiverLink, mode]);

  // Listen for session broadcasts from other tabs
  useEffect(() => {
    if (!sharedChannel) return;

    const handleMessage = (msg) => {
      if (msg.data.type === 'SESSION_CREATED' && !sessionId) {
        setSessionId(msg.data.sessionId);
        setExpiresAt(msg.data.expiresAt);
        setQrCode(msg.data.qrCode);
        setReceiverLink(msg.data.receiverLink);
        setMode(msg.data.mode);
      }
    };

    sharedChannel.addEventListener('message', handleMessage);
    return () => sharedChannel.removeEventListener('message', handleMessage);
  }, [sessionId]);

  // Handle receiver QR scan - open receiver page
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinSessionId = params.get('join');

    if (joinSessionId && !sessionId) {
      setSessionId(joinSessionId);
      setMode('receiver');
    }
  }, [sessionId]);

  // Auto-create session on component mount for host mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinSessionId = params.get('join');

    if (!sessionId && !isLoading && !joinSessionId) {
      createSession();
    }
  }, [createSession, isLoading, sessionId]);

  // Fetch receiver files periodically
  useEffect(() => {
    if (mode !== 'receiver' || !sessionId) return;

    const fetchInterval = setInterval(() => {
      fetchReceiverFiles(sessionId);
    }, 2000); // Poll every 2 seconds for new files

    fetchReceiverFiles(sessionId); // Initial fetch
    return () => clearInterval(fetchInterval);
  }, [sessionId, mode, fetchReceiverFiles]);


  const showStorageLimitError = useCallback(() => {
    alert(STORAGE_LIMIT_MESSAGE);
  }, []);

  const requestUploadUrl = useCallback(async (file) => {
    const response = await fetch(`${apiBase}/api/sharing/files?action=upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        fileName: file.name,
        filePath: file.webkitRelativePath || file.name,
        fileSize: file.size,
        contentType: file.type || 'application/octet-stream'
      })
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch (err) {
      payload = {};
    }

    if (response.status === 413) {
      showStorageLimitError();
      return { limitReached: true, error: STORAGE_LIMIT_MESSAGE };
    }

    if (!response.ok) {
      throw new Error(payload.error || `Upload preparation failed (${response.status})`);
    }

    return {
      uploadUrl: payload.uploadUrl,
      objectKey: payload.objectKey,
      contentType: payload.contentType || file.type || 'application/octet-stream'
    };
  }, [apiBase, sessionId, showStorageLimitError]);

  const markUploadComplete = useCallback(async (objectKey) => {
    const response = await fetch(`${apiBase}/api/sharing/files?action=complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, objectKey })
    });

    if (!response.ok) {
      throw new Error(`Finalize upload failed (${response.status})`);
    }
  }, [apiBase, sessionId]);

  const abortUpload = useCallback(async (objectKey) => {
    if (!objectKey) return;
    await fetch(`${apiBase}/api/sharing/files?action=abort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, objectKey })
    });
  }, [apiBase, sessionId]);

  const uploadFileToR2 = useCallback((file, uploadUrl, contentType, onProgress) => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', contentType || 'application/octet-stream');
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(event.loaded, event.total);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed (${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(file);
    });
  }, []);

  // Upload files with continuous real-time progress tracking
  const uploadFiles = useCallback(async (filesToUpload) => {
    if (!sessionId) {
      alert('No active session');
      return;
    }

    const totalSize = filesToUpload.reduce((sum, file) => sum + file.size, 0);
    uploadProgressRef.current = {};
    setTotalBytes(totalSize);
    setUploadedBytes(0);
    setTotalProgress(0);

    for (const file of filesToUpload) {
      const fileId = `${file.name}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      setCurrentlyUploading(file.name);

      setUploadProgress((prev) => ({
        ...prev,
        [fileId]: {
          name: file.name,
          bytes: 0,
          total: file.size,
          percent: 0
        }
      }));

      let uploadInfo;
      try {
        uploadInfo = await requestUploadUrl(file);
        if (uploadInfo.limitReached) {
          setUploadProgress((prev) => ({
            ...prev,
            [fileId]: { ...prev[fileId], error: STORAGE_LIMIT_MESSAGE }
          }));
          continue;
        }
      } catch (err) {
        console.error('Upload preparation failed:', err);
        setUploadProgress((prev) => ({
          ...prev,
          [fileId]: { ...prev[fileId], error: err.message }
        }));
        continue;
      }

      try {
        await uploadFileToR2(file, uploadInfo.uploadUrl, uploadInfo.contentType, (loaded) => {
          const safeLoaded = Math.min(loaded, file.size);
          setUploadProgress((prev) => ({
            ...prev,
            [fileId]: {
              ...prev[fileId],
              bytes: safeLoaded,
              percent: Math.round((safeLoaded / file.size) * 100)
            }
          }));

          setUploadedBytes((prevTotal) => {
            const previousBytes = uploadProgressRef.current[fileId]?.bytes || 0;
            const delta = Math.max(0, safeLoaded - previousBytes);
            uploadProgressRef.current[fileId] = { bytes: safeLoaded, total: file.size };
            const newTotal = prevTotal + delta;
            const percentage = totalSize ? Math.round((newTotal / totalSize) * 100) : 0;
            setTotalProgress(Math.min(99, percentage));
            return newTotal;
          });
        });

        await markUploadComplete(uploadInfo.objectKey);

        setUploadedBytes((prevTotal) => {
          const previousBytes = uploadProgressRef.current[fileId]?.bytes || 0;
          const delta = Math.max(0, file.size - previousBytes);
          uploadProgressRef.current[fileId] = { bytes: file.size, total: file.size };
          const newTotal = prevTotal + delta;
          const percentage = totalSize ? Math.round((newTotal / totalSize) * 100) : 0;
          setTotalProgress(Math.min(100, percentage));
          return newTotal;
        });

        setFiles((prev) => [
          ...prev,
          {
            id: fileId,
            name: file.name,
            size: file.size,
            status: 'complete',
            uploadedAt: new Date().toISOString(),
            objectKey: uploadInfo.objectKey
          }
        ]);

        setUploadProgress((prev) => ({
          ...prev,
          [fileId]: { ...prev[fileId], percent: 100, complete: true }
        }));
      } catch (err) {
        console.error('Upload failed:', err);
        await abortUpload(uploadInfo.objectKey);
        setUploadProgress((prev) => ({
          ...prev,
          [fileId]: { ...prev[fileId], error: err.message }
        }));
        setFiles((prev) => [
          ...prev,
          {
            id: fileId,
            name: file.name,
            size: file.size,
            status: 'error',
            uploadedAt: new Date().toISOString(),
            objectKey: uploadInfo.objectKey
          }
        ]);
      }
    }

    setCurrentlyUploading(null);
    setTotalProgress(100);
  }, [
    sessionId,
    requestUploadUrl,
    uploadFileToR2,
    markUploadComplete,
    abortUpload
  ]);

  // Handle file selection
  const handleFileSelect = useCallback(
    (e) => {
      const filesToAdd = Array.from(e.target.files || []);
      uploadFiles(filesToAdd);
    },
    [uploadFiles]
  );

  // Download file
  const downloadFile = useCallback(async (objectKey, fileName) => {
    if (!sessionId) return;

    const response = await fetch(
      `${apiBase}/api/sharing/files?action=download-url&sessionId=${sessionId}&objectKey=${encodeURIComponent(objectKey)}`
    );
    if (!response.ok) {
      throw new Error(`Download failed (${response.status})`);
    }

    const data = await response.json();
    const link = document.createElement('a');
    link.href = data.downloadUrl;
    if (fileName) link.download = fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [apiBase, sessionId]);

  // Toggle file selection for multiple downloads
  const toggleFileSelection = useCallback((objectKey) => {
    setSelectedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(objectKey)) {
        newSet.delete(objectKey);
      } else {
        newSet.add(objectKey);
      }
      return newSet;
    });
  }, []);

  // Select all files
  const selectAllFiles = useCallback(() => {
    const selectable = receiverFiles.filter((file) => file.status === 'complete');
    if (selectedFiles.size === selectable.length) {
      setSelectedFiles(new Set()); // Deselect all
    } else {
      setSelectedFiles(new Set(selectable.map((file) => file.objectKey)));
    }
  }, [receiverFiles, selectedFiles]);

  // Download selected files
  const downloadSelectedFiles = useCallback(async () => {
    const selected = receiverFiles.filter((file) => selectedFiles.has(file.objectKey));
    if (selected.length === 0) {
      alert('Please select files to download');
      return;
    }

    setIsDownloadingAll(true);
    try {
      for (const file of selected) {
        await downloadFile(file.objectKey, file.name);
        // Add small delay between downloads to prevent browser blocking
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err) {
      console.error('Download failed:', err);
      alert('Failed to download files');
    } finally {
      setIsDownloadingAll(false);
    }
  }, [selectedFiles, receiverFiles, downloadFile]);

  // Download all files
  const downloadAllFiles = useCallback(async () => {
    if (receiverFiles.length === 0) {
      alert('No files available');
      return;
    }

    setIsDownloadingAll(true);
    try {
      for (const file of receiverFiles) {
        if (file.status === 'complete') {
          await downloadFile(file.objectKey, file.name);
          // Add small delay between downloads to prevent browser blocking
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    } catch (err) {
      console.error('Download all failed:', err);
      alert('Failed to download files');
    } finally {
      setIsDownloadingAll(false);
    }
  }, [receiverFiles, downloadFile]);

  // Copy to clipboard
  const copyToClipboard = useCallback((text) => {
    navigator.clipboard.writeText(text);
  }, []);

  // End session (only host can do this)
  const endSession = useCallback(async () => {
    if (!sessionId) return;

    try {
      await fetch(`${apiBase}/api/sharing/session?action=end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });

      setSessionId(null);
      setQrCode(null);
      setReceiverLink(null);
      setFiles([]);
      setReceiverFiles([]);
      setSelectedFiles(new Set());
      setUploadProgress({});
      uploadProgressRef.current = {};
      setTotalBytes(0);
      setUploadedBytes(0);
      setTotalProgress(0);
      setSessionExpired(false);
      setMode('loading');
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    } catch (err) {
      console.error('End session failed:', err);
    }
  }, [apiBase, sessionId]);

  // Utility functions
  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatTime = (minutes, seconds) => {
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  // RENDER
  if (mode === 'receiver') {
    const completeFiles = receiverFiles.filter((file) => file.status === 'complete');
    return (
      <div className="image-sharing-container receiver-mode">
        <div className="receiver-session">
          {/* Receiver Header */}
          <div className="receiver-header">
            <h1 className="receiver-title">📥 Receive Files</h1>
            <div className="receiver-session-info">
              <div className="receiver-session-id">
                <span className="info-label">Session:</span>
                <span className="info-value">{sessionId}</span>
              </div>
              <div className="receiver-time">
                <span className="info-label">Time Left:</span>
                <span className="info-value">{formatTime(timeRemaining.minutes, timeRemaining.seconds)}</span>
              </div>
              {sessionExpired && (
                <div className="session-expired-badge">Session Expired</div>
              )}
            </div>
          </div>

          {/* Files Overview */}
          <div className="receiver-overview">
            <div className="overview-card">
              <div className="overview-icon">📦</div>
              <div className="overview-content">
                <div className="overview-label">Total Files</div>
                <div className="overview-value">{receiverFiles.length}</div>
              </div>
            </div>
            <div className="overview-card">
              <div className="overview-icon">💾</div>
              <div className="overview-content">
                <div className="overview-label">Total Size</div>
                <div className="overview-value">
                  {formatSize(receiverFiles.reduce((sum, file) => sum + (file.size || 0), 0))}
                </div>
              </div>
            </div>
            <div className="overview-card">
              <div className="overview-icon">✅</div>
              <div className="overview-content">
                <div className="overview-label">Complete Files</div>
                <div className="overview-value">{completeFiles.length}</div>
              </div>
            </div>
          </div>

          {/* Files List */}
          <div className="receiver-files-section">
            <div className="files-section-header">
              <h2>Available Files</h2>
              <div className="files-actions">
                {receiverFiles.length > 0 && (
                  <>
                    <button
                      className="btn-select-all"
                      onClick={selectAllFiles}
                      disabled={isDownloadingAll}
                    >
                      {selectedFiles.size === completeFiles.length && completeFiles.length > 0
                        ? '✓ Deselect All'
                        : '☐ Select All'}
                    </button>
                    <button
                      className="btn-download-all"
                      onClick={downloadAllFiles}
                      disabled={isDownloadingAll || completeFiles.length === 0}
                    >
                      {isDownloadingAll ? 'Downloading...' : '⬇ Download All'}
                    </button>
                  </>
                )}
              </div>
            </div>

            {completeFiles.length === 0 ? (
              <div className="no-files-message">
                <div className="no-files-icon">⏳</div>
                <p>Waiting for files...</p>
              </div>
            ) : (
              <div className="receiver-files-list">
                {receiverFiles.map((file, index) => (
                  file.status === 'complete' && (
                    <div key={file.objectKey || file.name} className="receiver-file-item">
                      <div className="file-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedFiles.has(file.objectKey)}
                          onChange={() => toggleFileSelection(file.objectKey)}
                          id={`file-${index}`}
                        />
                        <label htmlFor={`file-${index}`}></label>
                      </div>
                      <div className="file-details">
                        <div className="file-name">{file.name}</div>
                        <div className="file-size">{formatSize(file.size)}</div>
                      </div>
                      <button
                        className="btn-download-single"
                        onClick={() => downloadFile(file.objectKey, file.name)}
                        disabled={isDownloadingAll}
                        title="Download this file"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24">
                          <path
                            fill="currentColor"
                            d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"
                          />
                        </svg>
                      </button>
                    </div>
                  )
                ))}
              </div>
            )}

            {selectedFiles.size > 0 && (
              <div className="selected-actions">
                <button
                  className="btn-download-selected"
                  onClick={downloadSelectedFiles}
                  disabled={isDownloadingAll}
                >
                  ⬇ Download {selectedFiles.size} Selected File
                  {selectedFiles.size > 1 ? 's' : ''}
                </button>
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="receiver-message">
            💡 Receiver cannot end the session. The sender controls the session.
          </div>
        </div>
      </div>
    );
  }

  // HOST/SENDER VIEW
  return (
    <div className="image-sharing-container">
      <div className="sharing-session">
        {/* QR Code Card - Top Position */}
        <div className="qr-credentials-card">
          <div className="qr-section-wrapper">
            {/* QR Code */}
            <div className="qr-section">
              <div className="qr-card">
                <h3>Scan to Join</h3>
                {isLoading ? (
                  <div className="qr-code skeleton" style={{ width: '250px', height: '250px' }}></div>
                ) : (
                  <>
                    {qrCode && <img src={qrCode} alt="Session QR Code" className="qr-code" />}
                    <p className="qr-hint">Scan with another device</p>
                  </>
                )}
              </div>
            </div>

            {/* Session Credentials Bar - Right of QR */}
            <div className="credentials-bar">
              {isLoading ? (
                <>
                  <div className="cred-item skeleton" style={{ height: '40px', marginBottom: '1rem' }}></div>
                  <div className="cred-item skeleton" style={{ height: '40px' }}></div>
                </>
              ) : (
                <>
                  <div className="cred-item">
                    <span className="cred-label">Session ID</span>
                    <div className="cred-value-group">
                      <span className="cred-value">{sessionId}</span>
                      <button className="btn-copy-small" onClick={() => copyToClipboard(sessionId)}>
                        <svg width="14" height="14" viewBox="0 0 24 24">
                          <path fill="currentColor" d="M19 2H9c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 18H9V4h10v16zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="cred-item">
                    <span className="cred-label">Time Left</span>
                    <div className="cred-value-group">
                      <span className="cred-value time-value">
                        {formatTime(timeRemaining.minutes, timeRemaining.seconds)}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Copy Link */}
          {receiverLink && !isLoading && (
            <div className="copy-link-section">
              <button
                className="btn-copy-link"
                onClick={() => copyToClipboard(receiverLink)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                </svg>
                Copy Link
              </button>
            </div>
          )}
        </div>

        {/* Upload Section */}
        <div className="upload-section">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sessionExpired}
            className="btn-select-files"
          >
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path fill="currentColor" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            </svg>
            Select Files to Share
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
        </div>

        {/* Advanced Stats Cards */}
        {(totalBytes > 0 || Object.keys(uploadProgress).length > 0) && (
          <div className="advanced-stats">
            <div className="stat-card advanced">
              <div className="stat-header">
                <div className="stat-icon">📦</div>
                <span className="stat-title">Total Files</span>
              </div>
              <div className="stat-body">
                <div className="big-number">{files.length}</div>
                <div className="stat-subtext">files selected</div>
              </div>
            </div>
            <div className="stat-card advanced">
              <div className="stat-header">
                <div className="stat-icon">💾</div>
                <span className="stat-title">Total Size</span>
              </div>
              <div className="stat-body">
                <div className="big-number">{formatSize(totalBytes)}</div>
                <div className="stat-subtext">total upload size</div>
              </div>
            </div>
            <div className="stat-card advanced">
              <div className="stat-header">
                <div className="stat-icon">⬆️</div>
                <span className="stat-title">Uploaded</span>
              </div>
              <div className="stat-body">
                <div className="big-number">{formatSize(uploadedBytes)}</div>
                <div className="stat-subtext">uploaded so far</div>
              </div>
            </div>
          </div>
        )}

        {/* Global Progress */}
        {Object.keys(uploadProgress).length > 0 && (
          <div className="progress-section">
            <div className="progress-info">
              <div className="progress-label">
                Overall Progress: <strong>{totalProgress}%</strong>
              </div>
              {currentlyUploading && (
                <div className="uploading-status">Uploading: {currentlyUploading}</div>
              )}
            </div>
            <div className="progress-bar-container">
              <div className="progress-bar large">
                <div
                  className="progress-fill"
                  style={{ width: `${totalProgress}%` }}
                />
              </div>
            </div>

            {/* Files Dropdown */}
            {Object.keys(uploadProgress).length > 0 && (
              <div className="files-details-section">
                <button
                  className="btn-files-list"
                  onClick={() => setShowFilesDropdown(!showFilesDropdown)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/>
                  </svg>
                  Files ({Object.keys(uploadProgress).length})
                </button>

                {showFilesDropdown && (
                  <div className="files-list-detailed">
                    {Object.entries(uploadProgress).map(([id, prog]) => (
                      <div key={id} className="file-detail-item">
                        <div className="file-detail-header">
                          <span className="file-detail-name">{prog.name}</span>
                          <span className="file-detail-percent">{prog.percent || 0}%</span>
                        </div>
                        <div className="file-detail-progress">
                          <div className="progress-bar small">
                            <div
                              className="progress-fill"
                              style={{ width: `${prog.percent || 0}%` }}
                            />
                          </div>
                          <span className="file-detail-size">
                            {formatSize(prog.bytes || 0)} / {formatSize(prog.total || 0)}
                          </span>
                        </div>
                        {prog.error && (
                          <div className="file-error" title={prog.error}>
                            ⚠️ {prog.error}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Completed Files */}
        {files.length > 0 && (
          <div className="completed-files-section">
            <h3>✅ Completed Uploads ({files.length})</h3>
            <div className="completed-files-list">
              {files.map((file) => (
                <div key={file.id} className={`completed-file-item ${file.status}`}>
                  <div className="file-icon">📄</div>
                  <div className="file-info">
                    <span className="file-name">{file.name}</span>
                    <span className="file-size">{formatSize(file.size)}</span>
                  </div>
                  <div className="file-status">
                    {file.status === 'complete' ? '✓' : '✗'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* End Session Button */}
        <div className="session-actions">
          <button onClick={endSession} className="btn-end-session">
            End Session
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImageSharing;
