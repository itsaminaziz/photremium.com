import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SEO from '../SEO/SEO';
import FAQ from '../FAQ/FAQ';
import MobileImportPopup from '../MobileImportPopup/MobileImportPopup';
import { useLanguage } from '../../context/LanguageContext';
import './ResizeImage.css';

/* ---- helpers ---- */
const fmtSize = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

/* DPI for unit conversions (standard screen/print) */
const DPI = 96;
const CM_PER_INCH = 2.54;

/* Convert pixels ↔ other units */
const pxFromUnit = (val, unit) => {
  if (unit === 'pixel') return Math.round(val);
  if (unit === 'percentage') return val; // handled separately
  if (unit === 'inch') return Math.round(val * DPI);
  if (unit === 'cm') return Math.round((val / CM_PER_INCH) * DPI);
  return Math.round(val);
};

const unitFromPx = (px, unit) => {
  if (unit === 'pixel') return Math.round(px);
  if (unit === 'percentage') return 100; // default
  if (unit === 'inch') return parseFloat((px / DPI).toFixed(2));
  if (unit === 'cm') return parseFloat(((px / DPI) * CM_PER_INCH).toFixed(2));
  return px;
};

const resizeOrCropImage = (file, targetW, targetH, cropToFit) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const srcW = img.naturalWidth;
      const srcH = img.naturalHeight;
      const srcAspect = srcW / srcH;
      const targetAspect = targetW / targetH;

      if (cropToFit && Math.abs(srcAspect - targetAspect) > 0.002) {
        let sx = 0;
        let sy = 0;
        let sw = srcW;
        let sh = srcH;
        if (srcAspect > targetAspect) {
          sw = Math.round(srcH * targetAspect);
          sx = Math.round((srcW - sw) / 2);
        } else {
          sh = Math.round(srcW / targetAspect);
          sy = Math.round((srcH - sh) / 2);
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
      } else {
        ctx.drawImage(img, 0, 0, targetW, targetH);
      }

      const mime = file.type || 'image/png';
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error('Resize failed'));
        },
        mime,
        1
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });

/* Load natural dimensions of an image file */
const loadDimensions = (file) =>
  new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ w: 0, h: 0 });
    };
    img.src = url;
  });

const RESIZE_MODES = [
  { value: 'pixel', tKey: 'byPixels' },
  { value: 'percentage', tKey: 'byPercentage' },
  { value: 'cm', tKey: 'byCentimeters' },
  { value: 'inch', tKey: 'byInches' },
];

const RESIZE_TEMPLATES = [
  {
    name: 'YouTube Thumbnail',
    slug: 'yt-thumbnail',
    icon: 'fa-brands fa-youtube',
    width: 1280,
    height: 720,
    unit: 'px',
    seoTitle: 'YouTube Thumbnail Size (1280x720) Resizer | Photremium',
    seoDesc: 'Resize images to YouTube thumbnail size 1280x720 for crisp previews and better click-through.',
    seoKeywords: 'youtube thumbnail size, 1280x720, youtube thumbnail resizer',
  },
  {
    name: 'YouTube Banner',
    slug: 'yt-banner',
    icon: 'fa-brands fa-youtube',
    width: 2560,
    height: 1440,
    unit: 'px',
    seoTitle: 'YouTube Banner Size (2560x1440) Resizer | Photremium',
    seoDesc: 'Resize images to YouTube channel art size 2560x1440 for professional branding.',
    seoKeywords: 'youtube banner size, 2560x1440, channel art resizer',
  },
  {
    name: 'Instagram Post',
    slug: 'ig-post',
    icon: 'fa-brands fa-instagram',
    width: 1080,
    height: 1080,
    unit: 'px',
    seoTitle: 'Instagram Post Size (1080x1080) Resizer | Photremium',
    seoDesc: 'Resize images to Instagram post size 1080x1080 for sharp square posts.',
    seoKeywords: 'instagram post size, 1080x1080, instagram square resizer',
  },
  {
    name: 'Instagram Story',
    slug: 'ig-story',
    icon: 'fa-brands fa-instagram',
    width: 1080,
    height: 1920,
    unit: 'px',
    seoTitle: 'Instagram Story Size (1080x1920) Resizer | Photremium',
    seoDesc: 'Resize images to Instagram story size 1080x1920 for full-screen stories.',
    seoKeywords: 'instagram story size, 1080x1920, story resizer',
  },
  {
    name: 'Instagram Reel',
    slug: 'ig-reel',
    icon: 'fa-brands fa-instagram',
    width: 1080,
    height: 1920,
    unit: 'px',
    seoTitle: 'Instagram Reel Size (1080x1920) Resizer | Photremium',
    seoDesc: 'Resize images to Instagram Reel size 1080x1920 for vertical content.',
    seoKeywords: 'instagram reel size, 1080x1920, reel thumbnail resizer',
  },
  {
    name: 'Facebook Post',
    slug: 'fb-post',
    icon: 'fa-brands fa-facebook',
    width: 1200,
    height: 630,
    unit: 'px',
    seoTitle: 'Facebook Post Size (1200x630) Resizer | Photremium',
    seoDesc: 'Resize images to Facebook post size 1200x630 for link previews and posts.',
    seoKeywords: 'facebook post size, 1200x630, facebook resizer',
  },
  {
    name: 'Facebook Cover',
    slug: 'fb-cover',
    icon: 'fa-brands fa-facebook',
    width: 820,
    height: 312,
    unit: 'px',
    seoTitle: 'Facebook Cover Size (820x312) Resizer | Photremium',
    seoDesc: 'Resize images to Facebook cover size 820x312 for profile headers.',
    seoKeywords: 'facebook cover size, 820x312, facebook header resizer',
  },
  {
    name: 'X Post',
    slug: 'x-post',
    icon: 'fa-brands fa-x-twitter',
    width: 1600,
    height: 900,
    unit: 'px',
    seoTitle: 'X Post Size (1600x900) Resizer | Photremium',
    seoDesc: 'Resize images to X post size 1600x900 for optimal previews.',
    seoKeywords: 'x post size, twitter image size, 1600x900 resizer',
  },
  {
    name: 'X Header',
    slug: 'x-header',
    icon: 'fa-brands fa-x-twitter',
    width: 1500,
    height: 500,
    unit: 'px',
    seoTitle: 'X Header Size (1500x500) Resizer | Photremium',
    seoDesc: 'Resize images to X header size 1500x500 for profile banners.',
    seoKeywords: 'x header size, twitter header size, 1500x500 resizer',
  },
  {
    name: 'LinkedIn Post',
    slug: 'li-post',
    icon: 'fa-brands fa-linkedin',
    width: 1200,
    height: 627,
    unit: 'px',
    seoTitle: 'LinkedIn Post Size (1200x627) Resizer | Photremium',
    seoDesc: 'Resize images to LinkedIn post size 1200x627 for clean previews.',
    seoKeywords: 'linkedin post size, 1200x627, linkedin resizer',
  },
  {
    name: 'LinkedIn Banner',
    slug: 'li-banner',
    icon: 'fa-brands fa-linkedin',
    width: 1584,
    height: 396,
    unit: 'px',
    seoTitle: 'LinkedIn Banner Size (1584x396) Resizer | Photremium',
    seoDesc: 'Resize images to LinkedIn banner size 1584x396 for profile headers.',
    seoKeywords: 'linkedin banner size, 1584x396, linkedin header resizer',
  },
  {
    name: 'Pinterest Pin',
    slug: 'pinterest-pin',
    icon: 'fa-brands fa-pinterest',
    width: 1000,
    height: 1500,
    unit: 'px',
    seoTitle: 'Pinterest Pin Size (1000x1500) Resizer | Photremium',
    seoDesc: 'Resize images to Pinterest pin size 1000x1500 for tall pins.',
    seoKeywords: 'pinterest pin size, 1000x1500, pinterest resizer',
  },
  {
    name: 'TikTok Video',
    slug: 'tiktok-video',
    icon: 'fa-brands fa-tiktok',
    width: 1080,
    height: 1920,
    unit: 'px',
    seoTitle: 'TikTok Size (1080x1920) Resizer | Photremium',
    seoDesc: 'Resize images to TikTok size 1080x1920 for vertical content.',
    seoKeywords: 'tiktok size, 1080x1920, tiktok resizer',
  },
  {
    name: 'Snapchat Story',
    slug: 'snapchat-story',
    icon: 'fa-brands fa-snapchat',
    width: 1080,
    height: 1920,
    unit: 'px',
    seoTitle: 'Snapchat Story Size (1080x1920) Resizer | Photremium',
    seoDesc: 'Resize images to Snapchat story size 1080x1920 for full-screen stories.',
    seoKeywords: 'snapchat story size, 1080x1920, snapchat resizer',
  },
  {
    name: 'A4 Print',
    slug: 'a4-print',
    icon: 'fa-regular fa-file-lines',
    width: 2480,
    height: 3508,
    unit: 'px',
    seoTitle: 'A4 Size (2480x3508) Resizer | Photremium',
    seoDesc: 'Resize images to A4 size 2480x3508 at 300 DPI for print-ready files.',
    seoKeywords: 'a4 size px, 2480x3508, print resizer',
  },
  {
    name: 'A5 Print',
    slug: 'a5-print',
    icon: 'fa-regular fa-file-lines',
    width: 1748,
    height: 2480,
    unit: 'px',
    seoTitle: 'A5 Size (1748x2480) Resizer | Photremium',
    seoDesc: 'Resize images to A5 size 1748x2480 at 300 DPI for print.',
    seoKeywords: 'a5 size px, 1748x2480, print resizer',
  },
  {
    name: '4K UHD',
    slug: '4k-uhd',
    icon: 'fa-solid fa-tv',
    width: 3840,
    height: 2160,
    unit: 'px',
    seoTitle: '4K UHD Size (3840x2160) Resizer | Photremium',
    seoDesc: 'Resize images to 4K UHD 3840x2160 for crisp displays.',
    seoKeywords: '4k size, 3840x2160, uhd resizer',
  },
  {
    name: 'Desktop Wallpaper',
    slug: 'desktop-wallpaper',
    icon: 'fa-solid fa-desktop',
    width: 1920,
    height: 1080,
    unit: 'px',
    seoTitle: 'Desktop Wallpaper Size (1920x1080) Resizer | Photremium',
    seoDesc: 'Resize images to desktop wallpaper size 1920x1080.',
    seoKeywords: 'desktop wallpaper size, 1920x1080, wallpaper resizer',
  },
  {
    name: 'Web Banner',
    slug: 'web-banner',
    icon: 'fa-solid fa-window-maximize',
    width: 1920,
    height: 480,
    unit: 'px',
    seoTitle: 'Web Banner Size (1920x480) Resizer | Photremium',
    seoDesc: 'Resize images to web banner size 1920x480 for hero sections.',
    seoKeywords: 'web banner size, 1920x480, hero image resizer',
  },
  {
    name: 'Square Thumb',
    slug: 'square-thumb',
    icon: 'fa-solid fa-border-all',
    width: 800,
    height: 800,
    unit: 'px',
    seoTitle: 'Square Thumbnail Size (800x800) Resizer | Photremium',
    seoDesc: 'Resize images to square thumbnail size 800x800 for grids and listings.',
    seoKeywords: 'square thumbnail, 800x800, square resizer',
  },
  {
    name: 'iPhone 14 Pro',
    slug: 'iphone-14-pro',
    icon: 'fa-solid fa-mobile-screen-button',
    width: 1290,
    height: 2796,
    unit: 'px',
    seoTitle: 'iPhone 14 Pro Wallpaper Size (1290x2796) Resizer | Photremium',
    seoDesc: 'Resize images to iPhone 14 Pro wallpaper size 1290x2796.',
    seoKeywords: 'iphone 14 pro wallpaper, 1290x2796, iphone wallpaper resizer',
  },
  {
    name: 'iPad Pro 12.9',
    slug: 'ipad-pro-12-9',
    icon: 'fa-solid fa-tablet-screen-button',
    width: 2048,
    height: 2732,
    unit: 'px',
    seoTitle: 'iPad Pro 12.9 Wallpaper Size (2048x2732) Resizer | Photremium',
    seoDesc: 'Resize images to iPad Pro 12.9 wallpaper size 2048x2732.',
    seoKeywords: 'ipad pro wallpaper, 2048x2732, ipad resizer',
  },
];

/* ============================================= */
/*             IMAGE RESIZER PAGE                */
/* ============================================= */
const ResizeImage = () => {
  const { t, lang, localePath } = useLanguage();
  const isBlogRtl = lang === 'ur' || lang === 'ar';
  const blog = t('resizer.blog');
  const blogSections = useMemo(() => (Array.isArray(blog?.sections) ? blog.sections : []), [blog]);
  const blogFaqId = 'imgresize-blog-faq';
  const blogToc = useMemo(
    () => [
      ...blogSections.map((section) => ({ id: section.id || section.title, label: section.tocLabel || section.title })),
      { id: blogFaqId, label: t('faq.heading') },
    ],
    [blogSections, t]
  );
  const [activeBlogId, setActiveBlogId] = useState(blogSections[0]?.id || blogSections[0]?.title || '');
  const location = useLocation();
  const [images, setImages] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [downloadMode, setDownloadMode] = useState('zip');
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

  /* Resize settings */
  const [resizeMode, setResizeMode] = useState('pixel');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [lockAspect, setLockAspect] = useState(true);
  const [dontEnlarge, setDontEnlarge] = useState(true);
  const [activeTemplate, setActiveTemplate] = useState(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateQuery, setTemplateQuery] = useState('');

  /* Aspect ratio from first image */
  const [aspectRatio, setAspectRatio] = useState(1);
  /* Original dimensions of the first image (reference) */
  const [origW, setOrigW] = useState(0);
  const [origH, setOrigH] = useState(0);

  const fileInputRef = useRef(null);
  const addFileInputRef = useRef(null);
  const didPrefillFromStateRef = useRef(false);
  const dragDepthRef = useRef(0);

  const templateParam = useMemo(() => new URLSearchParams(location.search).get('template'), [location.search]);
  const templatePreview = useMemo(() => RESIZE_TEMPLATES.slice(0, 6), []);
  const filteredTemplates = useMemo(() => {
    const q = templateQuery.trim().toLowerCase();
    if (!q) return RESIZE_TEMPLATES;
    return RESIZE_TEMPLATES.filter((tpl) => {
      const text = `${tpl.name} ${tpl.slug}`.toLowerCase();
      return text.includes(q);
    });
  }, [templateQuery]);

  const applyTemplate = useCallback((tpl) => {
    if (!tpl) return;
    setActiveTemplate(tpl);
    setResizeMode('pixel');
    setLockAspect(true);
    setWidth(tpl.width);
    setHeight(tpl.height);
    setAspectRatio(tpl.width / tpl.height);
    setImages((prev) => prev.map((img) => ({ ...img, resizedBlob: null, resizedSize: null })));
  }, []);

  useEffect(() => {
    if (!templateParam) return;
    const tpl = RESIZE_TEMPLATES.find((t) => t.slug === templateParam);
    if (tpl) applyTemplate(tpl);
  }, [templateParam, applyTemplate]);

  /* --- warn before reload --- */
  useEffect(() => {
    const handler = (e) => {
      if (images.length > 0) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [images.length]);

  /* --- add files --- */
  const addFiles = useCallback(async (files) => {
    const validFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!validFiles.length) return;
    const newImages = await Promise.all(
      validFiles.map(async (file) => {
        const dims = await loadDimensions(file);
        return {
          id: crypto.randomUUID(),
          file,
          preview: URL.createObjectURL(file),
          origW: dims.w,
          origH: dims.h,
          resizedBlob: null,
          resizedSize: null,
        };
      })
    );
    setImages((prev) => {
      const merged = [...prev, ...newImages];
      /* Set defaults from the first image if this is the initial upload */
      if (prev.length === 0 && newImages.length > 0) {
        const first = newImages[0];
        setOrigW(first.origW);
        setOrigH(first.origH);
        setAspectRatio(first.origW / first.origH);
        setWidth(unitFromPx(first.origW, resizeMode));
        setHeight(unitFromPx(first.origH, resizeMode));
      }
      return merged;
    });
  }, [resizeMode]);

  /* --- prefill from Home paste popup --- */
  useEffect(() => {
    if (didPrefillFromStateRef.current) return;
    const incoming = location.state?.pastedImages;
    if (!Array.isArray(incoming) || incoming.length === 0) return;
    didPrefillFromStateRef.current = true;
    addFiles(incoming);
  }, [location.state, addFiles]);

  /* --- Ctrl+V paste --- */
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

  /* --- hide footer when editing --- */
  useEffect(() => {
    if (images.length > 0) {
      document.body.classList.add('ri-workspace-active');
    } else {
      document.body.classList.remove('ri-workspace-active');
    }
    return () => document.body.classList.remove('ri-workspace-active');
  }, [images.length]);

  /* --- handle dimension changes with aspect lock --- */
  const handleWidthChange = (val) => {
    const v = val === '' ? '' : Number(val);
    setWidth(v);
    if (activeTemplate) setActiveTemplate(null);
    if (lockAspect && v !== '' && aspectRatio) {
      if (resizeMode === 'percentage') {
        setHeight(v);
      } else {
        const wPx = pxFromUnit(v, resizeMode);
        const hPx = Math.round(wPx / aspectRatio);
        setHeight(unitFromPx(hPx, resizeMode));
      }
    }
    /* Clear previous resized blobs */
    setImages((prev) => prev.map((img) => ({ ...img, resizedBlob: null, resizedSize: null })));
  };

  const handleHeightChange = (val) => {
    const v = val === '' ? '' : Number(val);
    setHeight(v);
    if (activeTemplate) setActiveTemplate(null);
    if (lockAspect && v !== '' && aspectRatio) {
      if (resizeMode === 'percentage') {
        setWidth(v);
      } else {
        const hPx = pxFromUnit(v, resizeMode);
        const wPx = Math.round(hPx * aspectRatio);
        setWidth(unitFromPx(wPx, resizeMode));
      }
    }
    setImages((prev) => prev.map((img) => ({ ...img, resizedBlob: null, resizedSize: null })));
  };

  /* --- when resize mode changes, recalculate width/height --- */
  const handleModeChange = (mode) => {
    /* Convert current values back to px, then to new unit */
    let curWPx = origW;
    let curHPx = origH;
    if (width !== '' && height !== '') {
      if (resizeMode === 'percentage') {
        curWPx = Math.round(origW * width / 100);
        curHPx = Math.round(origH * height / 100);
      } else {
        curWPx = pxFromUnit(width, resizeMode);
        curHPx = pxFromUnit(height, resizeMode);
      }
    }
    setResizeMode(mode);
    setActiveTemplate(null);
    if (mode === 'percentage') {
      setWidth(origW > 0 ? Math.round((curWPx / origW) * 100) : 100);
      setHeight(origH > 0 ? Math.round((curHPx / origH) * 100) : 100);
    } else {
      setWidth(unitFromPx(curWPx, mode));
      setHeight(unitFromPx(curHPx, mode));
    }
    setImages((prev) => prev.map((img) => ({ ...img, resizedBlob: null, resizedSize: null })));
  };

  /* --- compute final pixel dimensions for an image --- */
  const getFinalDims = (img) => {
    let targetW, targetH;
    if (activeTemplate) {
      targetW = activeTemplate.width;
      targetH = activeTemplate.height;
    } else if (resizeMode === 'percentage') {
      targetW = Math.round(img.origW * (width || 100) / 100);
      targetH = Math.round(img.origH * (height || 100) / 100);
    } else {
      targetW = pxFromUnit(width || unitFromPx(img.origW, resizeMode), resizeMode);
      targetH = pxFromUnit(height || unitFromPx(img.origH, resizeMode), resizeMode);
    }
    if (!activeTemplate && dontEnlarge) {
      targetW = Math.min(targetW, img.origW);
      targetH = Math.min(targetH, img.origH);
    }
    return { w: Math.max(1, targetW), h: Math.max(1, targetH) };
  };

  /* --- resize all images --- */
  const resizeAll = async () => {
    setResizing(true);
    try {
      const results = await Promise.all(
        images.map(async (img) => {
          if (img.resizedBlob) {
            return { id: img.id, blob: img.resizedBlob, size: img.resizedSize ?? img.resizedBlob.size };
          }
          const dims = getFinalDims(img);
          const blob = await resizeOrCropImage(img.file, dims.w, dims.h, Boolean(activeTemplate));
          return { id: img.id, blob, size: blob.size };
        })
      );

      const resultMap = new Map(results.map((r) => [r.id, r]));
      const nextImages = images.map((img) => {
        const r = resultMap.get(img.id);
        if (!r) return img;
        return { ...img, resizedBlob: r.blob, resizedSize: r.size };
      });

      setImages(nextImages);
      return nextImages.filter((img) => img.resizedBlob);
    } catch (err) {
      console.error('Resize error:', err);
      return [];
    } finally {
      setResizing(false);
    }
  };

  /* --- remove image --- */
  const removeImage = (id) => {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.preview);
      const remaining = prev.filter((i) => i.id !== id);
      /* If first image was removed, update dimensions from new first image */
      if (remaining.length > 0 && prev[0]?.id === id) {
        const newFirst = remaining[0];
        setOrigW(newFirst.origW);
        setOrigH(newFirst.origH);
        setAspectRatio(newFirst.origW / newFirst.origH);
        setWidth(unitFromPx(newFirst.origW, resizeMode));
        setHeight(unitFromPx(newFirst.origH, resizeMode));
      }
      return remaining;
    });
  };

  /* --- download single --- */
  const downloadSingle = (img) => {
    if (!img.resizedBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(img.resizedBlob);
    const baseName = img.file.name.replace(/\.[^.]+$/, '');
    const ext = img.file.name.match(/\.[^.]+$/)?.[0] || '.png';
    a.download = `${baseName}-resized${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* --- download separate --- */
  const downloadSeparate = (readyImages = null) => {
    const ready = readyImages || images.filter((i) => i.resizedBlob);
    ready.forEach((img) => downloadSingle(img));
  };

  /* --- download zip --- */
  const downloadZip = async (readyImages = null) => {
    const ready = readyImages || images.filter((i) => i.resizedBlob);
    if (!ready.length) return;
    if (!window.JSZip) {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      document.head.appendChild(s);
      await new Promise((r) => (s.onload = r));
    }
    const zip = new window.JSZip();
    ready.forEach((img) => {
      const baseName = img.file.name.replace(/\.[^.]+$/, '');
      const ext = img.file.name.match(/\.[^.]+$/)?.[0] || '.png';
      zip.file(`${baseName}-resized${ext}`, img.resizedBlob);
    });
    const content = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content);
    a.download = 'resized-images.zip';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* --- download all (respects mode) --- */
  const downloadAll = async (readyImages = null) => {
    const ready = readyImages || images.filter((i) => i.resizedBlob);
    if (!ready.length) return;
    if (ready.length === 1) { downloadSingle(ready[0]); return; }
    if (downloadMode === 'zip') await downloadZip(ready);
    else downloadSeparate(ready);
  };

  const handleResizeAndDownload = async () => {
    const ready = await resizeAll();
    if (!ready.length) return;
    await downloadAll(ready);
  };

  /* --- start over --- */
  const handleStartOver = () => {
    const confirmed = window.confirm(t('common.startOverConfirm'));
    if (!confirmed) return;
    images.forEach((i) => URL.revokeObjectURL(i.preview));
    setImages([]);
    setWidth('');
    setHeight('');
  };

  /* --- drag & drop --- */
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

  const handleBlogTocClick = useCallback((e, id) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.pageYOffset - 110;
    window.scrollTo({ top, behavior: 'smooth' });
    setActiveBlogId(id);
  }, []);

  useEffect(() => {
    const newActive = blogSections[0]?.id || blogSections[0]?.title || '';
    setActiveBlogId(newActive);
  }, [blogSections]);

  useEffect(() => {
    if (!blogSections.length || images.length > 0) return;
    const observers = [];
    blogToc.forEach((item) => {
      const element = document.getElementById(item.id);
      if (!element) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveBlogId(item.id);
        },
        { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
      );
      observer.observe(element);
      observers.push(observer);
    });
    return () => observers.forEach((observer) => observer.disconnect());
  }, [blogToc, blogSections.length, images.length]);

  /* --- computed --- */
  const totalOriginal = images.reduce((s, i) => s + i.file.size, 0);
  /* Unit suffix for inputs */
  const unitSuffix = resizeMode === 'pixel' ? 'px' : resizeMode === 'percentage' ? '%' : resizeMode === 'cm' ? 'cm' : 'in';
  const inputStep = resizeMode === 'pixel' || resizeMode === 'percentage' ? 1 : 0.1;
  const seoUploadTitle = activeTemplate?.seoTitle || t('resizer.seo.uploadTitle');
  const seoUploadDesc = activeTemplate?.seoDesc || t('resizer.seo.uploadDesc');
  const seoUploadKeywords = activeTemplate?.seoKeywords || t('resizer.seo.uploadKeywords');
  const seoWorkspaceTitle = activeTemplate?.seoTitle || t('resizer.seo.workspaceTitle');
  const seoWorkspaceDesc = activeTemplate?.seoDesc || t('resizer.seo.workspaceDesc');
  const seoWorkspaceKeywords = activeTemplate?.seoKeywords || t('resizer.seo.workspaceKeywords');

  /* =========================== UPLOAD VIEW =========================== */
  if (!images.length) {
    return (
      <>
        <SEO
          title={seoUploadTitle}
          description={seoUploadDesc}
          keywords={seoUploadKeywords}
        />
        <section className="rsz-upload">
          <div className="rsz-upload__inner">
            <h1 className="rsz-upload__title">{t('resizer.title')}</h1>
            <p className="rsz-upload__desc">
              {t('resizer.desc')}
            </p>

            <div
              className={`rsz-dropzone ${dragOver ? 'rsz-dropzone--active' : ''}`}
              onDragEnter={onDragEnter}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <div className="rsz-dropzone__cloud">
                <i className="fa-solid fa-cloud-arrow-up"></i>
              </div>
              <h3>{t('common.dropHere')}</h3>
              <p>{t('common.or')} <span className="rsz-dropzone__browse" onClick={() => fileInputRef.current?.click()}>{t('common.browseFiles')}</span> {t('resizer.toResize')}</p>
              <p className="rsz-dropzone__hint">
                <i className="fa-regular fa-keyboard"></i> {t('common.pasteHint')} <kbd>Ctrl</kbd> + <kbd>V</kbd>
              </p>
              <div style={{ marginTop: 20, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <button className="rsz-dropzone__btn" onClick={() => fileInputRef.current?.click()} style={{ marginTop: 0 }}>
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

            {blogSections.length ? (
              <>
            <nav className={`rsz-blog-toc--mobile ${isBlogRtl ? 'rsz-blog-toc--mobile--rtl' : ''}`} aria-label="Image resizer blog sections">
              {blogToc.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className={activeBlogId === item.id ? 'toc-active' : ''}
                  onClick={(e) => handleBlogTocClick(e, item.id)}
                >
                  {item.label}
                </a>
              ))}
            </nav>

            <div className={`rsz-blog-layout ${isBlogRtl ? 'rsz-blog-layout--rtl' : ''}`}>
              <aside className="rsz-blog-toc" aria-label="Image resizer blog table of contents">
                <p className="rsz-blog-toc__title">{blog.tocTitle || 'Contents'}</p>
                <ul className="rsz-blog-toc__list">
                  {blogToc.map((item) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        className={activeBlogId === item.id ? 'toc-active' : ''}
                        onClick={(e) => handleBlogTocClick(e, item.id)}
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </aside>

              <section className="rsz-blog">
                {blogSections.map((section) => (
                  <article className="rsz-blog__card" id={section.id || section.title} key={section.id || section.title}>
                    <h2>{section.title}</h2>

                    {Array.isArray(section.paragraphs)
                      ? section.paragraphs.map((paragraph, idx) => <p key={`p-${idx}`}>{paragraph}</p>)
                      : null}

                    {section.listTitle ? <h3>{section.listTitle}</h3> : null}

                    {Array.isArray(section.bullets) ? (
                      <ul className="rsz-blog__list">
                        {section.bullets.map((bullet, idx) => (
                          <li key={`b-${idx}`}>{bullet}</li>
                        ))}
                      </ul>
                    ) : null}

                    {Array.isArray(section.steps) ? (
                      <ol className="rsz-blog__ordered">
                        {section.steps.map((step, idx) => (
                          <li key={`step-${idx}`}>
                            <p>{step.heading}</p>
                            {Array.isArray(step.bullets) ? (
                              <ul className="rsz-blog__ordered-sub">
                                {step.bullets.map((bullet, bIdx) => (
                                  <li key={`sb-${bIdx}`}>{bullet}</li>
                                ))}
                              </ul>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    ) : null}

                    {Array.isArray(section.formats) ? (
                      <div className="rsz-blog__chips" aria-label="Supported formats">
                        {section.formats.map((fmt, fIdx) => (
                          <span className="rsz-blog__chip" key={`f-${fIdx}`}>
                            {fmt}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}

                <section className="rsz-blog__faq-section" id={blogFaqId}>
                  <FAQ faqKey="resizeImage" />
                </section>
              </section>
            </div>
              </>
            ) : null}
          </div>
        </section>
      </>
    );
  }

  /* =========================== WORKSPACE VIEW =========================== */
  return (
    <>
      <SEO
        title={seoWorkspaceTitle}
        description={seoWorkspaceDesc}
        keywords={seoWorkspaceKeywords}
      />

      <section
        className={`rsz-workspace ${dragOver ? 'rsz-workspace--dragover' : ''}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* Mobile settings toggle */}
        <button
          className="rsz-settings-toggle"
          onClick={() => setMobileToolsOpen((prev) => !prev)}
          aria-label={t('common.toggleToolsPanel') || 'Toggle tools panel'}
        >
          <i className={mobileToolsOpen ? 'fa-solid fa-xmark' : 'fa-solid fa-gear'}></i>
        </button>

        {mobileToolsOpen && (
          <div className="rsz-overlay" onClick={() => setMobileToolsOpen(false)} />
        )}

        {/* ---------- LEFT PANEL (Preview) ---------- */}
        <div className="rsz-left">
          <div className="rsz-cards">
            {images.map((img) => (
              <div className="rsz-card" key={img.id}>
                <button className="rsz-card__remove" title={t('common.remove')} onClick={() => removeImage(img.id)}>
                  <i className="fa-solid fa-xmark"></i>
                </button>

                <div className="rsz-card__preview">
                  <img src={img.preview} alt={img.file.name} />
                </div>

                <div className="rsz-card__body">
                  <span className="rsz-card__name" title={img.file.name}>
                    <i className="fa-regular fa-image"></i> {img.file.name}
                  </span>
                  <div className="rsz-card__meta">
                    <span className="rsz-card__dims">
                      <i className="fa-solid fa-ruler-combined"></i> {img.origW} × {img.origH}
                    </span>
                    {img.resizedBlob && (
                      <>
                        <i className="fa-solid fa-arrow-right rsz-card__arrow"></i>
                        <span className="rsz-card__dims rsz-card__dims--new">
                          {getFinalDims(img).w} × {getFinalDims(img).h}
                        </span>
                      </>
                    )}
                    <span className="rsz-card__size">
                      <i className="fa-solid fa-weight-hanging"></i> {fmtSize(img.file.size)}
                    </span>
                  </div>

                </div>
              </div>
            ))}
            {/* +Add Image card */}
            <div className="rsz-card rsz-card--add" onClick={() => addFileInputRef.current?.click()} title={t('common.addMoreImages')}>
              <div className="rsz-card__add-inner">
                <i className="fa-solid fa-plus"></i>
                <span>{t('common.addImage')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ---------- RIGHT PANEL (Tools) ---------- */}
        <div className={`rsz-right ${mobileToolsOpen ? 'rsz-right--open' : ''}`}>
          <div className="rsz-right__sticky">
            <div className="rsz-right__header">
              <h3><i className="fa-solid fa-up-right-and-down-left-from-center"></i> {t('resizer.resizeSettings')}</h3>
              <button className="rsz-right__close" onClick={() => setMobileToolsOpen(false)} aria-label="Close panel">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            {/* Summary stats */}
            <div className="rsz-right__stats">
              <div className="rsz-stat">
                <span className="rsz-stat__label">{t('common.images')}</span>
                <span className="rsz-stat__value">{images.length}</span>
              </div>
              <div className="rsz-stat">
                <span className="rsz-stat__label">{t('common.totalSize')}</span>
                <span className="rsz-stat__value">{fmtSize(totalOriginal)}</span>
              </div>
            </div>

            {/* Resize mode dropdown */}
            <div className="rsz-right__section">
              <label className="rsz-right__label">{t('resizer.resizeBy')}</label>
              <select
                className="rsz-select"
                value={resizeMode}
                onChange={(e) => handleModeChange(e.target.value)}
              >
                {RESIZE_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{t(`resizer.${m.tKey}`)}</option>
                ))}
              </select>
            </div>

            {/* Width & Height inputs */}
            <div className="rsz-right__section">
              <div className="rsz-dims">
                <div className="rsz-dim">
                  <label className="rsz-dim__label">{t('common.width')}</label>
                  <div className="rsz-dim__input-wrap">
                    <div className="rsz-dim__arrows">
                      <button type="button" className="rsz-dim__arrow" onClick={() => handleWidthChange(parseFloat((Number(width || 0) + inputStep).toFixed(2)))} tabIndex={-1}>
                        <i className="fa-solid fa-chevron-up"></i>
                      </button>
                      <button type="button" className="rsz-dim__arrow" onClick={() => handleWidthChange(Math.max(inputStep, parseFloat((Number(width || 0) - inputStep).toFixed(2))))} tabIndex={-1}>
                        <i className="fa-solid fa-chevron-down"></i>
                      </button>
                    </div>
                    <input
                      type="number"
                      className="rsz-dim__input"
                      value={width}
                      onChange={(e) => handleWidthChange(e.target.value)}
                      min={resizeMode === 'percentage' ? 1 : 1}
                      step={resizeMode === 'pixel' ? 1 : resizeMode === 'percentage' ? 1 : 0.01}
                    />
                    <span className="rsz-dim__unit">{unitSuffix}</span>
                  </div>
                </div>
                <div className="rsz-dim__link">
                  <button
                    className={`rsz-dim__lock ${lockAspect ? 'active' : ''}`}
                    onClick={() => setLockAspect((p) => !p)}
                    title={lockAspect ? t('resizer.unlockAspect') : t('resizer.lockAspect')}
                  >
                    <i className={lockAspect ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'}></i>
                  </button>
                </div>
                <div className="rsz-dim">
                  <label className="rsz-dim__label">{t('common.height')}</label>
                  <div className="rsz-dim__input-wrap">
                    <div className="rsz-dim__arrows">
                      <button type="button" className="rsz-dim__arrow" onClick={() => handleHeightChange(parseFloat((Number(height || 0) + inputStep).toFixed(2)))} tabIndex={-1}>
                        <i className="fa-solid fa-chevron-up"></i>
                      </button>
                      <button type="button" className="rsz-dim__arrow" onClick={() => handleHeightChange(Math.max(inputStep, parseFloat((Number(height || 0) - inputStep).toFixed(2))))} tabIndex={-1}>
                        <i className="fa-solid fa-chevron-down"></i>
                      </button>
                    </div>
                    <input
                      type="number"
                      className="rsz-dim__input"
                      value={height}
                      onChange={(e) => handleHeightChange(e.target.value)}
                      min={resizeMode === 'percentage' ? 1 : 1}
                      step={resizeMode === 'pixel' ? 1 : resizeMode === 'percentage' ? 1 : 0.01}
                    />
                    <span className="rsz-dim__unit">{unitSuffix}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Templates strip */}
            <div className="rsz-right__section">
              <label className="rsz-right__label">Templates</label>
              <div className="rsz-template-strip" role="list">
                {templatePreview.map((tpl) => (
                  <Link
                    key={tpl.slug}
                    to={localePath(`/resize-image?template=${tpl.slug}`)}
                    className={`rsz-template-chip ${activeTemplate?.slug === tpl.slug ? 'active' : ''}`}
                    onClick={() => applyTemplate(tpl)}
                    role="listitem"
                    aria-label={`${tpl.name} ${tpl.width}x${tpl.height}`}
                  >
                    <i className={tpl.icon}></i>
                  </Link>
                ))}
                <button
                  type="button"
                  className="rsz-template-chip rsz-template-more"
                  onClick={() => setTemplatesOpen(true)}
                  aria-label="More templates"
                >
                  +{RESIZE_TEMPLATES.length}
                </button>
              </div>
            </div>

            {/* Advanced options */}
            <div className="rsz-right__section">
              <label className="rsz-right__label">{t('resizer.advanced')}</label>
              <div className="rsz-toggle-list">
                <label className="rsz-toggle-item">
                  <input
                    type="checkbox"
                    checked={lockAspect}
                    onChange={(e) => setLockAspect(e.target.checked)}
                  />
                  <span className="rsz-toggle-item__check">
                    <i className="fa-solid fa-check"></i>
                  </span>
                  <span>{t('resizer.lockAspect')}</span>
                </label>
                <label className="rsz-toggle-item">
                  <input
                    type="checkbox"
                    checked={dontEnlarge}
                    onChange={(e) => setDontEnlarge(e.target.checked)}
                  />
                  <span className="rsz-toggle-item__check">
                    <i className="fa-solid fa-check"></i>
                  </span>
                  <span>{t('resizer.dontEnlarge')}</span>
                </label>
              </div>
            </div>

            {/* Add more images */}
            <button className="rsz-right__add" onClick={() => addFileInputRef.current?.click()}>
              <i className="fa-solid fa-plus"></i> {t('common.addMoreImages')}
            </button>
            <input
              ref={addFileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
            />

            {/* Download mode selector */}
            {images.length > 1 && (
              <div className="rsz-right__dl-mode">
                <label>{t('common.downloadAs')}:</label>
                <div className="rsz-dl-toggle">
                  <button
                    className={`rsz-dl-toggle__btn ${downloadMode === 'zip' ? 'active' : ''}`}
                    onClick={() => setDownloadMode('zip')}
                  >
                    <i className="fa-solid fa-file-zipper"></i> {t('common.zip')}
                  </button>
                  <button
                    className={`rsz-dl-toggle__btn ${downloadMode === 'separate' ? 'active' : ''}`}
                    onClick={() => setDownloadMode('separate')}
                  >
                    <i className="fa-regular fa-copy"></i> {t('common.separate')}
                  </button>
                </div>
              </div>
            )}

            <button className="rsz-right__reset" onClick={handleStartOver}>
              <i className="fa-solid fa-arrow-rotate-left"></i> {t('common.startOver')}
            </button>

            {/* Sticky download button */}
            <div className="rsz-right__actions">
              <button
                className="rsz-right__download"
                onClick={handleResizeAndDownload}
                disabled={resizing || width === '' || height === ''}
              >
                {resizing ? (
                  <>
                    <span className="rsz-download-spinner"></span>
                    {t('resizer.resizing')}
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-bolt"></i> {t('resizer.resizeDownload')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </section>

      {templatesOpen && (
        <div className="rsz-template-modal" role="dialog" aria-modal="true" aria-label="Resize templates">
          <button className="rsz-template-modal__backdrop" onClick={() => setTemplatesOpen(false)} aria-label="Close templates" />
          <div className="rsz-template-modal__card">
            <div className="rsz-template-modal__header">
              <h4>Resize Templates</h4>
              <button type="button" onClick={() => setTemplatesOpen(false)} aria-label="Close">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="rsz-template-search">
              <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
              <input
                type="search"
                value={templateQuery}
                onChange={(e) => setTemplateQuery(e.target.value)}
                placeholder="Search templates"
                aria-label="Search templates"
              />
            </div>
            <div className="rsz-template-grid">
              {filteredTemplates.map((tpl) => (
                <Link
                  key={tpl.slug}
                  to={localePath(`/resize-image?template=${tpl.slug}`)}
                  className={`rsz-template-card ${activeTemplate?.slug === tpl.slug ? 'active' : ''}`}
                  onClick={() => { applyTemplate(tpl); setTemplatesOpen(false); }}
                >
                  <span className="rsz-template-card__icon"><i className={tpl.icon}></i></span>
                  <span className="rsz-template-card__name">{tpl.name}</span>
                  <span className="rsz-template-card__size">{tpl.width} × {tpl.height} {tpl.unit}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ResizeImage;