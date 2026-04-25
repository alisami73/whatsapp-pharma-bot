// Blink Premium — Shared Components (Navbar, Footer, Logo, Scroll animations)

const LOGO_FULL_IMG = () => `<img src="${BLINK_LOGO_DATA_URL}" alt="Blink Premium" style="height:38px;width:auto;display:block;">`;
const LOGO_ICON_IMG = () => `<span style="display:inline-flex;overflow:hidden;width:38px;height:38px;flex-shrink:0;border-radius:10px;">
  <img src="${BLINK_LOGO_DATA_URL}" alt="Blink" style="height:38px;width:auto;max-width:none;display:block;">
</span>`;

// ─── Language selector helper ────────────────────────────────────────────────
function langUrl(targetLang) {
  const u = new URL(window.location.href);
  u.searchParams.set('lang', targetLang);
  return u.toString();
}

const LANG_FLAGS = { fr: '🇫🇷', ar: '🇲🇦', es: '🇪🇸', ru: '🇷🇺' };
const LANG_LABELS = { fr: 'FR', ar: 'AR', es: 'ES', ru: 'RU' };

function buildLangSelector() {
  const cur = (typeof BI18N !== 'undefined') ? BI18N.lang : 'fr';
  const langs = ['fr', 'ar', 'es', 'ru'];
  return `
  <div class="lang-selector" style="position:relative;display:inline-flex;align-items:center;">
    <button class="lang-btn" id="langBtn" aria-label="Langue" style="
      display:flex;align-items:center;gap:5px;padding:0.35rem 0.75rem;
      border-radius:100px;border:1.5px solid var(--blink-border);background:white;
      font-size:0.8125rem;font-weight:600;cursor:pointer;color:var(--blink-text);
      transition:border-color 0.2s;
    ">${LANG_FLAGS[cur]} ${LANG_LABELS[cur]} <span style="font-size:0.6rem;opacity:0.5;">▾</span></button>
    <div class="lang-dropdown" id="langDropdown" style="
      display:none;position:absolute;top:calc(100% + 6px);right:0;
      background:white;border:1.5px solid var(--blink-border);border-radius:12px;
      box-shadow:0 8px 24px rgba(0,0,0,0.1);overflow:hidden;z-index:300;min-width:110px;
    ">
      ${langs.map(l => `
        <a href="${langUrl(l)}" style="
          display:flex;align-items:center;gap:8px;padding:0.55rem 1rem;
          font-size:0.875rem;font-weight:${l===cur?'700':'500'};
          color:${l===cur?'var(--blink-green)':'var(--blink-text)'};
          background:${l===cur?'color-mix(in srgb,var(--blink-green) 8%,white)':'white'};
          text-decoration:none;transition:background 0.15s;
        " onmouseover="this.style.background='var(--blink-bg)'" onmouseout="this.style.background='${l===cur?'color-mix(in srgb,var(--blink-green) 8%,white)':'white'}'">
          <span>${LANG_FLAGS[l]}</span><span>${LANG_LABELS[l]}</span>
        </a>
      `).join('')}
    </div>
  </div>`;
}

function injectNavbar(activePage) {
  const t = (typeof BI18N !== 'undefined') ? BI18N.t : null;
  const lq = (p) => {
    if (typeof BI18N === 'undefined' || BI18N.lang === 'fr') return p;
    return p + '?lang=' + BI18N.lang;
  };

  const links = [
    { label: t ? t.nav_home     : 'Accueil',          href: lq('index.html'),   id: 'home' },
    { label: t ? t.nav_features : 'Fonctionnalités',  href: lq('premium.html'), id: 'premium' },
    { label: t ? t.nav_contact  : 'Contact',          href: lq('contact.html'), id: 'contact' },
  ];
  const ctaLabel = t ? t.nav_cta : 'Demander une démo';

  const navHTML = `
  <nav class="navbar">
    <a href="${lq('index.html')}" class="navbar-logo">
      ${LOGO_ICON_IMG()}
      <span class="navbar-wordmark">blink <strong>premium</strong></span>
    </a>
    <ul class="navbar-links">
      ${links.map(l => `<li><a href="${l.href}" class="${l.id === activePage ? 'active' : ''}">${l.label}</a></li>`).join('')}
    </ul>
    <div class="navbar-cta">
      ${buildLangSelector()}
      <a href="${lq('contact.html')}" class="btn btn-primary btn-sm">${ctaLabel}</a>
      <button class="hamburger" id="hamburger" aria-label="Menu">
        <span></span><span></span><span></span>
      </button>
    </div>
  </nav>
  <div class="mobile-nav" id="mobileNav">
    <div class="mobile-nav-panel">
      <button class="mobile-nav-close" id="mobileNavClose">✕</button>
      <div style="margin-bottom:1rem;">${LOGO_FULL_IMG()}</div>
      ${links.map(l => `<a href="${l.href}">${l.label}</a>`).join('')}
      <a href="${lq('contact.html')}" class="btn btn-primary">${ctaLabel}</a>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('afterbegin', navHTML);

  // Hamburger
  document.getElementById('hamburger').addEventListener('click', () => {
    document.getElementById('mobileNav').classList.add('open');
  });
  document.getElementById('mobileNavClose').addEventListener('click', () => {
    document.getElementById('mobileNav').classList.remove('open');
  });
  document.getElementById('mobileNav').addEventListener('click', (e) => {
    if (e.target === document.getElementById('mobileNav'))
      document.getElementById('mobileNav').classList.remove('open');
  });

  // Lang dropdown toggle
  const langBtn = document.getElementById('langBtn');
  const langDrop = document.getElementById('langDropdown');
  langBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    langDrop.style.display = langDrop.style.display === 'block' ? 'none' : 'block';
  });
  document.addEventListener('click', () => { langDrop.style.display = 'none'; });
}

function injectFooter() {
  const t = (typeof BI18N !== 'undefined') ? BI18N.t : null;
  const lq = (p) => {
    if (typeof BI18N === 'undefined' || BI18N.lang === 'fr') return p;
    return p + '?lang=' + BI18N.lang;
  };
  const ft = {
    desc:    t ? t.footer_desc    : 'La solution SaaS de gestion de pharmacie pensée pour les pharmaciens marocains.',
    nav:     t ? t.footer_nav     : 'Navigation',
    feat:    t ? t.footer_feat    : 'Fonctionnalités',
    contact: t ? t.footer_contact : 'Contact',
    rights:  t ? t.footer_rights  : '© 2026 Blink Pharma · Tous droits réservés',
    privacy: t ? t.footer_privacy : 'Politique de confidentialité',
    cgu:     t ? t.footer_cgu     : 'CGU',
    stocks:  (typeof BI18N !== 'undefined' && BI18N.features) ? BI18N.features[2].title : 'Contrôle des stocks',
    inv:     (typeof BI18N !== 'undefined' && BI18N.features) ? BI18N.features[3].title : 'Inventaire mobile',
    scan:    (typeof BI18N !== 'undefined' && BI18N.features) ? BI18N.features[4].title : 'Scan intelligent',
    app:     (typeof BI18N !== 'undefined' && BI18N.features) ? BI18N.features[6].title : 'Application mobile',
    navCta:  t ? t.nav_cta        : 'Demander une démo',
    privacyHref: lq('data-cndp.html'),
  };

  const footerHTML = `
  <footer>
    <div class="footer-grid">
      <div class="footer-col">
        <div style="margin-bottom:1.25rem;">
          <img src="${BLINK_LOGO_DATA_URL}" alt="Blink Premium" style="height:48px;width:auto;display:block;filter:brightness(0) invert(1);opacity:0.85;">
        </div>
        <p>${ft.desc}</p>
      </div>
      <div class="footer-col">
        <h4>${ft.nav}</h4>
        <ul>
          <li><a href="${lq('index.html')}">${t ? t.nav_home : 'Accueil'}</a></li>
          <li><a href="${lq('premium.html')}">${t ? t.nav_features : 'Fonctionnalités'}</a></li>
          <li><a href="${lq('contact.html')}">${t ? t.nav_contact : 'Contact'}</a></li>
          <li><a href="${lq('contact.html')}">${ft.navCta}</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>${ft.feat}</h4>
        <ul>
          <li><a href="${lq('premium.html')}#stocks">${ft.stocks}</a></li>
          <li><a href="${lq('premium.html')}#inventaire-mobile">${ft.inv}</a></li>
          <li><a href="${lq('premium.html')}#scan-ia">${ft.scan}</a></li>
          <li><a href="${lq('premium.html')}#app-mobile">${ft.app}</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>${ft.contact}</h4>
        <ul>
          <li><a href="mailto:contact@blinkpharmacie.ma">contact@blinkpharmacie.ma</a></li>
          <li><a href="https://wa.me/212600000000" target="_blank">WhatsApp</a></li>
          <li><a href="#">Casablanca, Maroc</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>${ft.rights}</span>
      <div style="display:flex;gap:1.5rem">
        <a href="${ft.privacyHref}">${ft.privacy}</a>
        <a href="#">${ft.cgu}</a>
      </div>
    </div>
  </footer>`;

  document.body.insertAdjacentHTML('beforeend', footerHTML);
}

function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const delay = entry.target.dataset.delay || 0;
        setTimeout(() => entry.target.classList.add('visible'), delay);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.fade-up').forEach((el, i) => {
    if (!el.dataset.delay) el.dataset.delay = (i % 4) * 80;
    observer.observe(el);
  });
}

document.addEventListener('DOMContentLoaded', initScrollAnimations);
