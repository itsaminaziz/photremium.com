/*

Script to generate blogs-sitemap.xml from blogCards.js and languages.js. Run this before building the site to ensure the sitemap is up to date.

node scripts/generate-blogs-sitemap.js
type public\\blogs-sitemap.xml

*/



const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const blogCardsPath = path.join(root, 'src', 'Components', 'Blogs', 'blogCards.js');
const languagesPath = path.join(root, 'src', 'i18n', 'languages.js');
const outPath = path.join(root, 'public', 'blogs-sitemap.xml');

function extractBlogCards(content) {
  const items = [];
  // match object literal blocks containing slug and date (simple heuristic)
  const objRegex = /\{([\s\S]*?)\}/g;
  let m;
  while ((m = objRegex.exec(content))) {
    const block = m[1];
    const slugMatch = block.match(/slug\s*:\s*['"]([^'"\n]+)['"]/);
    if (!slugMatch) continue;
    const dateMatch = block.match(/date\s*:\s*['"]([^'"\n]+)['"]/);
    items.push({ slug: slugMatch[1], date: dateMatch ? dateMatch[1] : null });
  }
  return items;
}

function extractLangCodes(content) {
  const codes = [];
  const re = /code:\s*['"]([^'"\n]+)['"]/g;
  let m;
  while ((m = re.exec(content))) codes.push(m[1]);
  return codes.length ? codes : ['en'];
}

function formatDate(d) {
  if (!d) return new Date().toISOString().split('T')[0];
  try {
    return new Date(d).toISOString().split('T')[0];
  } catch (e) {
    return new Date().toISOString().split('T')[0];
  }
}

function buildXml(entries) {
  const now = new Date().toISOString().split('T')[0];
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  entries.forEach((e) => {
    xml += '  <url>\n';
    xml += `    <loc>${e.loc}</loc>\n`;
    xml += `    <lastmod>${e.lastmod || now}</lastmod>\n`;
    xml += '    <changefreq>weekly</changefreq>\n';
    xml += '    <priority>0.7</priority>\n';
    xml += '  </url>\n';
  });
  xml += '</urlset>\n';
  return xml;
}

function main() {
  if (!fs.existsSync(blogCardsPath)) {
    console.error('blogCards.js not found at', blogCardsPath);
    process.exit(1);
  }
  const cardsRaw = fs.readFileSync(blogCardsPath, 'utf8');
  const blogs = extractBlogCards(cardsRaw);
  if (!fs.existsSync(languagesPath)) {
    console.warn('languages.js not found, defaulting to en');
  }
  const langRaw = fs.existsSync(languagesPath) ? fs.readFileSync(languagesPath, 'utf8') : '';
  const langs = extractLangCodes(langRaw);

  const host = 'https://photremium.com';
  const urls = [];
  blogs.forEach((b) => {
    langs.forEach((lang) => {
      const prefix = lang === 'en' ? '' : `/${lang}`;
      const loc = `${host}${prefix}/blogs/${b.slug}`;
      urls.push({ loc, lastmod: formatDate(b.date) });
    });
  });

  const xml = buildXml(urls);
  fs.writeFileSync(outPath, xml, 'utf8');
  console.log('Wrote', outPath, 'with', urls.length, 'entries');
}

if (require.main === module) main();
