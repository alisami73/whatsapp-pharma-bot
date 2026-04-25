// Blink Premium — Shared Components (Navbar, Footer, Logo, Scroll animations)

// Logo helpers — uses embedded base64 data URL (no path issues)
// BLINK_LOGO_DATA_URL is defined in assets/logo-data.js, loaded before this file

const LOGO_FULL_IMG = () => `<img src="${BLINK_LOGO_DATA_URL}" alt="Blink Premium" style="height:38px;width:auto;display:block;">`;

// Icon-only: clip to left square portion of the logo (icon ≈ 38% of width)
const LOGO_ICON_IMG = () => `<span style="display:inline-flex;overflow:hidden;width:38px;height:38px;flex-shrink:0;border-radius:10px;">
  <img src="${BLINK_LOGO_DATA_URL}" alt="Blink" style="height:38px;width:auto;max-width:none;display:block;">
</span>`;

function injectNavbar(activePage) {
  const links = [
    { label: 'Accueil', href: 'index.html', id: 'home' },
    { label: 'Fonctionnalités', href: 'premium.html', id: 'premium' },
    { label: 'Contact', href: 'contact.html', id: 'contact' },
  ];

  const navHTML = `
  <nav class="navbar">
    <a href="index.html" class="navbar-logo">
      ${LOGO_ICON_IMG()}
      <span class="navbar-wordmark">blink <strong>premium</strong></span>
    </a>
    <ul class="navbar-links">
      ${links.map(l => `<li><a href="${l.href}" class="${l.id === activePage ? 'active' : ''}">${l.label}</a></li>`).join('')}
    </ul>
    <div class="navbar-cta">
      <a href="premium.html" class="btn btn-outline btn-sm" style="display:none" id="nav-features-btn">Fonctionnalités</a>
      <a href="contact.html" class="btn btn-primary btn-sm">Demander une démo</a>
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
      <a href="contact.html" class="btn btn-primary">Demander une démo</a>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('afterbegin', navHTML);

  document.getElementById('hamburger').addEventListener('click', () => {
    document.getElementById('mobileNav').classList.add('open');
  });
  document.getElementById('mobileNavClose').addEventListener('click', () => {
    document.getElementById('mobileNav').classList.remove('open');
  });
  document.getElementById('mobileNav').addEventListener('click', (e) => {
    if (e.target === document.getElementById('mobileNav')) {
      document.getElementById('mobileNav').classList.remove('open');
    }
  });
}

function injectFooter() {
  const footerHTML = `
  <footer>
    <div class="footer-grid">
      <div class="footer-col">
        <div style="margin-bottom:1.25rem;">
          <img src="${BLINK_LOGO_DATA_URL}" alt="Blink Premium" style="height:48px;width:auto;display:block;filter:brightness(0) invert(1);opacity:0.85;">
        </div>
        <p>La solution SaaS de gestion de pharmacie pensée pour les pharmaciens marocains. Moderne, intuitive et fiable.</p>
      </div>
      <div class="footer-col">
        <h4>Navigation</h4>
        <ul>
          <li><a href="index.html">Accueil</a></li>
          <li><a href="premium.html">Fonctionnalités</a></li>
          <li><a href="contact.html">Contact</a></li>
          <li><a href="contact.html">Demander une démo</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>Fonctionnalités</h4>
        <ul>
          <li><a href="premium.html#stocks">Contrôle des stocks</a></li>
          <li><a href="premium.html#inventaire-mobile">Inventaire mobile</a></li>
          <li><a href="premium.html#scan-ia">Scan intelligent</a></li>
          <li><a href="premium.html#app-mobile">Application mobile</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>Contact</h4>
        <ul>
          <li><a href="mailto:contact@blinkpharmacie.ma">contact@blinkpharmacie.ma</a></li>
          <li><a href="https://wa.me/212600000000" target="_blank">WhatsApp</a></li>
          <li><a href="#">Casablanca, Maroc</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2026 Blink Pharma · Tous droits réservés</span>
      <div style="display:flex;gap:1.5rem">
        <a href="#">Politique de confidentialité</a>
        <a href="#">CGU</a>
      </div>
    </div>
  </footer>`;

  document.body.insertAdjacentHTML('beforeend', footerHTML);
}

function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
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
