import React, { useEffect, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { Helmet, HelmetProvider } from 'react-helmet-async';
import { LanguageProvider } from './context/LanguageContext';
import { ContactProvider } from './context/ContactContext';
import Navbar from './Components/Navbar/Navbar';
import Footer from './Components/Footer/Footer';
import ContactForm from './Components/ContactForm/ContactForm';
import Home from './Components/Pages/Home';
import About from './Components/Pages/About';
import ImageConverter from './Components/Pages/ImageConverter';
import ImageCompressor from './Components/Pages/ImageCompressor';
import ResizeImage from './Components/Pages/ResizeImage';
import CropImage from './Components/Pages/CropImage';
import RemoveBackground from './Components/Pages/RemoveBackground';
import RemoveBackgroundAI from './Components/Pages/RemoveBackgroundAI';
import WatermarkImage from './Components/Pages/WatermarkImage';
import QRCodeGenerator from './Components/Pages/QRCodeGenerator';
import QRCodeScanner from './Components/Pages/QRCodeScanner';
import FaceBlur from './Components/Pages/FaceBlur';
import PrivacyPolicy from './Components/Pages/PrivacyPolicy';
import SitemapPage from './Components/Pages/SitemapPage';
import ImageSharing from './Components/ImageSharing/ImageSharing';
import NotFound from './Components/Pages/NotFound';
import Blogs from './Components/Pages/Blogs';
import BlogDetail from './Components/Pages/BlogDetail';
import ScrollToTop from './Components/ScrollToTop';
import { LANG_CODES } from './i18n/languages';
import './App.css';

/**
 * PageRouter strips the language prefix from the URL and renders the correct
 * page component via an inner <Routes> matched against the clean path.
 *
 * WHY THIS PATTERN:
 *   The outer <Route path="*"> NEVER changes match, so PageRouter is NEVER
 *   unmounted when the language changes.  The inner <Routes> uses a synthetic
 *   location whose pathname has the lang segment removed, so page components
 *   only unmount/remount when the actual PAGE changes — not the language.
 *
 *   Before this fix the two-route structure ("<Route path='/'>" + "<Route
 *   path='/:lang'>") caused React Router to swap entire component trees on
 *   every language switch, unmounting all page components and forcing a full
 *   reinitialisation — which showed as "content disappears" on the home page.
 */
function PageRouter() {
  const location = useLocation();

  // Build a synthetic location with the lang prefix stripped so the inner
  // <Routes> always sees a clean path like "/about", "/image-compressor", etc.
  const strippedLocation = useMemo(() => {
    const segments = location.pathname.split('/').filter(Boolean);
    const hasLang = segments.length > 0 && LANG_CODES.has(segments[0]);
    const cleanPath = hasLang
      ? '/' + segments.slice(1).join('/')
      : location.pathname || '/';
    return { ...location, pathname: cleanPath || '/' };
  }, [location]);

  return (
    <Routes location={strippedLocation}>
      <Route index element={<Home />} />
      <Route path="about" element={<About />} />
      <Route path="image-converter" element={<ImageConverter />} />
      <Route path="convert/:conversionType" element={<ImageConverter />} />
      <Route path="image-compressor" element={<ImageCompressor />} />
      <Route path="resize-image" element={<ResizeImage />} />
      <Route path="crop-image" element={<CropImage />} />
      <Route path="remove-background" element={<RemoveBackground />} />
      <Route path="remove-background-ai" element={<RemoveBackgroundAI />} />
      <Route path="watermark-image" element={<WatermarkImage />} />
      <Route path="qr-code-generator" element={<QRCodeGenerator />} />
      <Route path="qr-code-scanner" element={<QRCodeScanner />} />
      <Route path="face-blur" element={<FaceBlur />} />
        <Route path="image-sharing" element={<ImageSharing />} />
      <Route path="privacy-policy" element={<PrivacyPolicy />} />
      <Route path="sitemap" element={<SitemapPage />} />
      <Route path="blogs" element={<Blogs />} />
      <Route path="blogs/:slug" element={<BlogDetail />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const CANONICAL_BASE = 'https://photremium.com';

const normalizeCanonicalPath = (pathname) => {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '');
};

function CanonicalLink() {
  const location = useLocation();
  const canonicalPath = normalizeCanonicalPath(location.pathname);
  const canonicalUrl = `${CANONICAL_BASE}${canonicalPath}`;

  useEffect(() => {
    let canonicalTag = document.querySelector('link[rel="canonical"]');
    if (!canonicalTag) {
      canonicalTag = document.createElement('link');
      canonicalTag.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalTag);
    }
    canonicalTag.setAttribute('href', canonicalUrl);
  }, [canonicalUrl]);

  return (
    <Helmet key={canonicalUrl}>
      <link rel="canonical" href={canonicalUrl} />
    </Helmet>
  );
}


function App() {
  return (
    <HelmetProvider>
      <Router>
        <LanguageProvider>
          <ContactProvider>
            <ScrollToTop />
            <CanonicalLink />
            <div className="App">
              <Navbar />
              <main className="main-content">
                {/*
                  Single catch-all route — PageRouter handles both "/" and
                  "/:lang/" without ever unmounting page components on language
                  switches.  See PageRouter above for the full explanation.
                */}
                <Routes>
                  <Route path="*" element={<PageRouter />} />
                </Routes>
              </main>
              <Footer />
              {/* Global contact popup — rendered once, controlled via ContactContext */}
              <ContactForm mode="popup" />
            </div>
          </ContactProvider>
        </LanguageProvider>
      </Router>
    </HelmetProvider>
  );
}

export default App;