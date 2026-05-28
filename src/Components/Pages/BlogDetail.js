import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import SEO from '../SEO/SEO';
import FAQ from '../FAQ/FAQ';
import { useLanguage } from '../../context/LanguageContext';
import { blogCards, getCardLocale } from '../Blogs/blogCards';
import { blogContent, getBlogLocale, getBlogSlug, matchesBlogSlug } from '../Blogs/blogContent';
import MobileImportPopup from '../MobileImportPopup/MobileImportPopup';
import './Blogs.css';

const BlogDetail = () => {
  const { slug } = useParams();
  const { lang, localePath, t } = useLanguage();
  const navigate = useNavigate();
  const uploadInputRef = useRef(null);
  const dragDepthRef = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const blog = useMemo(() => blogContent.find((b) => matchesBlogSlug(b, slug)), [slug]);
  const card = useMemo(() => {
    if (blog) return blogCards.find((c) => c.slug === blog.slug);
    return blogCards.find((c) => c.slug === slug);
  }, [blog, slug]);

  useEffect(() => {
    if (!blog) return;
    const desiredSlug = getBlogSlug(blog, lang);
    if (desiredSlug && desiredSlug !== slug) {
      navigate(localePath(`/blogs/${desiredSlug}`), { replace: true });
    }
  }, [blog, lang, slug, navigate, localePath]);

  if (!card || !blog) {
    return (
      <section className="blogs-page">
        <div className="blogs-hero">
          <div className="blogs-hero__text">
            <h1>Blog not found</h1>
            <p>The blog you are looking for does not exist.</p>
            <Link to={localePath('/blogs')} className="blog-back blog-back--button">Back to blogs</Link>
          </div>
        </div>
      </section>
    );
  }

  const cardLocale = getCardLocale(card, lang);
  const blogLocale = getBlogLocale(blog, lang);
  const toolLink = (card.toolLink || '').trim();
  const canUpload = Boolean(toolLink);
  const isBlogRtl = lang === 'ur' || lang === 'ar';

  const resolveBlogImage = (image) => {
    if (!image || typeof image !== 'string') return '';
    if (image.startsWith('http://') || image.startsWith('https://') || image.startsWith('/')) return image;
    return `${process.env.PUBLIC_URL}/Images/blogs/${image}`;
  };

  const normalizeMarkdownText = (text) => {
    if (typeof text !== 'string') return '';
    return text
      .replace(/\$([^$]+)\$/g, '$1')
      .replace(/\\times/g, 'x')
      .replace(/\\div/g, '/')
      .replace(/\\text\{([^}]+)\}/g, '$1')
      .replace(/\\%/g, '%');
  };

  const handleFiles = (files) => {
    const valid = Array.from(files || []).filter((f) => f && f.type?.startsWith('image/'));
    if (!valid.length) {
      setUploadError('Please upload an image file.');
      return;
    }
    if (!canUpload) {
      setUploadError('Tool link not set for this blog yet.');
      return;
    }
    setUploadError('');
    navigate(localePath(toolLink), { state: { pastedImages: valid } });
  };

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
    handleFiles(e.dataTransfer.files);
  };

  const faqItems = (blogLocale.faqs || []).map((item) => ({
    q: normalizeMarkdownText(item.q || item.question || ''),
    a: normalizeMarkdownText(item.a || item.answer || ''),
  })).filter((item) => item.q && item.a);

  return (
    <section className={`blogs-page blog-detail ${isBlogRtl ? 'blog-detail--rtl' : ''}`}>
      <SEO
        title={cardLocale.title}
        description={cardLocale.desc}
        keywords={cardLocale.metaKeywords}
      />

      <div className="blog-detail__hero">
        <div className="blog-detail__hero-card">
          <div className="blog-detail__top-row">
            <Link to={localePath('/blogs')} className="blog-back blog-back--button">
              <i className="fa-solid fa-arrow-left"></i> Back to blogs
            </Link>
            <span className="blog-detail__eyebrow">Photremium Blog</span>
          </div>
          <h1>{blogLocale.title}</h1>
          <p>{blogLocale.intro}</p>
          <div className="blog-detail__meta-row">
            <div className="blog-detail__meta">
              <span>{new Date(card.date).toLocaleDateString()}</span>
              <span>•</span>
              <span>{card.readTime}</span>
            </div>
            <div className="blog-detail__chips">
              {card.tags.map((tag) => (
                <span key={tag} className="blog-detail__chip">{tag}</span>
              ))}
            </div>
          </div>
        </div>
        <aside className="blog-detail__hero-side">
          <div
            className={`comp-dropzone blog-detail__dropzone ${dragOver ? 'comp-dropzone--active' : ''}`}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <div className="comp-dropzone__cloud">
              <i className="fa-solid fa-cloud-arrow-up"></i>
            </div>
            <h3>{t('common.dropHere')}</h3>
            <p>
              {t('common.or')}{' '}
              <span
                className="comp-dropzone__browse"
                onClick={() => uploadInputRef.current?.click()}
              >
                {t('common.browseFiles')}
              </span>
            </p>
            <p className="comp-dropzone__hint">
              <i className="fa-regular fa-keyboard"></i> {t('common.pasteHint')} <kbd>Ctrl</kbd> + <kbd>V</kbd>
            </p>
            <div className="blog-detail__drop-actions">
              <MobileImportPopup onImportFiles={handleFiles} />
              <button
                className="comp-dropzone__btn"
                type="button"
                onClick={() => uploadInputRef.current?.click()}
                style={{ marginTop: 0 }}
              >
                <i className="fa-solid fa-folder-open"></i> {t('common.chooseFiles')}
              </button>
            </div>
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          <button
            className="blog-detail__try"
            type="button"
            disabled={!canUpload}
            onClick={() => {
              if (!canUpload) {
                setUploadError('Tool link not set for this blog yet.');
                return;
              }
              setUploadError('');
              navigate(localePath(toolLink));
            }}
          >
            Try Now -&gt;
          </button>
          {uploadError && <p className="blog-detail__drop-error">{uploadError}</p>}
          {!canUpload && !uploadError && (
            <p className="blog-detail__drop-note">Tool link not set yet.</p>
          )}
        </aside>
      </div>

      <div className="blog-detail__body">
        <div className="blog-detail__body-card">
          <div className="blog-detail__image">
            <img
              src={resolveBlogImage(blog.heroImage)}
              alt={blogLocale.title}
              loading="lazy"
              decoding="async"
            />
          </div>

          <div className="blog-detail__content">
            {blogLocale.sections.map((section, index) => (
              <article key={`${section.heading}-${index}`} className="blog-section">
                <h2>{section.heading}</h2>
                {section.imageAfterHeading && (
                  <div className="blog-section__media">
                    <img
                      src={resolveBlogImage(section.imageAfterHeading)}
                      alt={section.heading}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                )}
                {section.body && (
                  <div className="blog-section__body">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                      {normalizeMarkdownText(section.body)}
                    </ReactMarkdown>
                  </div>
                )}
                {section.imageAfterBody && (
                  <div className="blog-section__media">
                    <img
                      src={resolveBlogImage(section.imageAfterBody)}
                      alt={section.heading}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
        {faqItems.length ? (
          <FAQ
            faqs={faqItems}
            showHeader={false}
            questionHeader={`${t('faq.heading')} (FAQs)`}
            renderMarkdown
          />
        ) : null}
      </div>
    </section>
  );
};

export default BlogDetail;
