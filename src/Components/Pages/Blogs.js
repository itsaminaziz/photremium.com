import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import SEO from '../SEO/SEO';
import { useLanguage } from '../../context/LanguageContext';
import { blogCards, getCardLocale } from '../Blogs/blogCards';
import { getBlogSlugByBaseSlug } from '../Blogs/blogContent';
import './Blogs.css';

const sorters = {
  newest: (a, b) => new Date(b.date) - new Date(a.date),
  popular: (a, b) => Number(a.id) - Number(b.id),
};

const Blogs = () => {
  const { t, lang, localePath } = useLanguage();
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState('All');
  const [sortBy, setSortBy] = useState('newest');

  const tags = useMemo(() => {
    const list = new Set();
    blogCards.forEach((c) => c.tags.forEach((tag) => list.add(tag)));
    return ['All', ...Array.from(list)];
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const data = blogCards.filter((card) => {
      const locale = getCardLocale(card, lang);
      const matchTag = activeTag === 'All' || card.tags.includes(activeTag);
      const text = `${locale.title} ${locale.desc} ${card.tags.join(' ')}`.toLowerCase();
      const matchQuery = q.length === 0 || text.includes(q);
      return matchTag && matchQuery;
    });
    return data.sort(sorters[sortBy]);
  }, [query, activeTag, sortBy, lang]);

  return (
    <section className="blogs-page">
      <SEO
        title={t('seo.blogsTitle')}
        description={t('seo.blogsDesc')}
        keywords={t('seo.blogsKeywords')}
      />

      <div className="blogs-hero">
        <div className="blogs-hero__text">
          <h1>{t('blogs.title')}</h1>
          <p>{t('blogs.subtitle')}</p>
        </div>
        <div className="blogs-hero__glow" aria-hidden="true" />
      </div>

      <div className="blogs-toolbar">
        <div className="blogs-search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('blogs.searchPlaceholder')}
            aria-label={t('blogs.searchPlaceholder')}
          />
        </div>

        <div className="blogs-sort">
          <label htmlFor="sort-select">Sort</label>
          <select id="sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="newest">{t('blogs.sortNewest')}</option>
            <option value="popular">{t('blogs.sortPopular')}</option>
          </select>
        </div>
      </div>

      <div className="blogs-tags" role="tablist" aria-label="Filter blog posts">
        {tags.map((tag) => (
          <button
            key={tag}
            role="tab"
            className={`tag-chip ${activeTag === tag ? 'active' : ''}`}
            onClick={() => setActiveTag(tag)}
            aria-selected={activeTag === tag}
          >
            {tag}
          </button>
        ))}
      </div>

      <div className="blogs-grid">
        {filtered.map((card, index) => {
          const locale = getCardLocale(card, lang);
          const cardSlug = getBlogSlugByBaseSlug(card.slug, lang);
          const tnSrc = card.tn.includes('/') || card.tn.startsWith('data:')
            ? card.tn
            : `${process.env.PUBLIC_URL}/Images/blogs/${card.tn}`;
          return (
            <motion.article
              key={card.slug}
              className="blog-card"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
            >
              <Link to={localePath(`/blogs/${cardSlug}`)} className="blog-card__media">
                <img
                  src={tnSrc}
                  alt={locale.title}
                  loading="lazy"
                  decoding="async"
                />
                <span className="blog-card__tag">{locale.cardTag}</span>
              </Link>
              <div className="blog-card__body">
                <div className="blog-card__meta">
                  <span>{new Date(card.date).toLocaleDateString()}</span>
                  <span>•</span>
                  <span>{card.readTime}</span>
                </div>
                <h2>{locale.title}</h2>
                <p>{locale.desc}</p>
                <div className="blog-card__tags">
                  {card.tags.map((t) => (
                    <span key={t} className="mini-tag">{t}</span>
                  ))}
                </div>
                <Link to={localePath(`/blogs/${cardSlug}`)} className="blog-card__link">
                  Read more <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                </Link>
              </div>
            </motion.article>
          );
        })}
      </div>

    </section>
  );
};

export default Blogs;
