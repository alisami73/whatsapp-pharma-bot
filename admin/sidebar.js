/**
 * admin/sidebar.js — injecte la sidebar gauche dans toutes les pages admin.
 * Inclure ce script après auth-guard.js dans chaque page.
 * Usage: <script src="/admin/sidebar.js" data-page="actu"></script>
 */
(function () {
  const NAV = [
    { section: 'Vue d\'ensemble' },
    { page: 'dashboard', label: 'Dashboard', icon: '▪', href: '/admin' },
    { section: 'Contenu' },
    { page: 'actu',      label: 'Actu Médicaments',      icon: '▪', href: '/admin/actu' },
    { page: 'themes',    label: 'Thèmes',                icon: '▪', href: '/admin/themes' },
    { page: 'content',   label: 'Base de connaissances', icon: '▪', href: '/admin/content' },
    { section: 'Pharmaciens' },
    { page: 'crm',       label: 'Utilisateurs WhatsApp', icon: '▪', href: '/admin/crm' },
    { page: 'consents',  label: 'Consentements CGU',     icon: '▪', href: '/admin/consents' },
    { section: 'Twilio' },
    { page: 'templates', label: 'Templates',             icon: '▪', href: '/admin/templates' },
    { page: 'monitoring',label: 'Monitoring',            icon: '▪', href: '/admin/monitoring' },
    { section: 'Système' },
    { page: 'refopposables', label: 'Réf. Opposables',  icon: '▪', href: '/admin/refopposables' },
    { page: 'users',     label: 'Accès Admin',           icon: '▪', href: '/admin/users' },
  ];

  const CSS = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body { font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 15px; background: #f0f2f5; color: #1a2332; line-height: 1.5; }
    .adm-wrap { display: flex; height: 100vh; overflow: hidden; }
    /* Sidebar */
    .adm-sidebar { width: 228px; min-width: 228px; background: #1a3a2a; display: flex; flex-direction: column; flex-shrink: 0; }
    .adm-logo { padding: 20px 18px 16px; border-bottom: 1px solid rgba(255,255,255,0.08); }
    .adm-brand { font-size: 15px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px; font-family: 'Nunito', 'DM Sans', sans-serif; }
    .adm-dot { width: 9px; height: 9px; background: #4caf82; border-radius: 50%; flex-shrink: 0; }
    .adm-sub { font-size: 12px; color: rgba(255,255,255,0.4); margin-top: 3px; padding-left: 17px; }
    .adm-nav { padding: 12px 8px; flex: 1; overflow-y: auto; }
    .adm-section { font-size: 11px; color: rgba(255,255,255,0.32); text-transform: uppercase; letter-spacing: 0.1em; padding: 12px 10px 6px; font-weight: 700; }
    .adm-item { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 8px; cursor: pointer; color: rgba(255,255,255,0.6); font-size: 14px; font-weight: 500; margin-bottom: 2px; transition: all 0.15s; text-decoration: none; }
    .adm-item:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.9); }
    .adm-item.active { background: rgba(76,175,130,0.18); color: #7dd4a8; font-weight: 700; }
    .adm-footer { padding: 14px; border-top: 1px solid rgba(255,255,255,0.07); }
    .adm-logout { display: flex; align-items: center; gap: 8px; color: rgba(255,255,255,0.45); font-size: 13px; text-decoration: none; padding: 7px 10px; border-radius: 7px; transition: color 0.15s; cursor: pointer; background: none; border: none; width: 100%; font-family: inherit; }
    .adm-logout:hover { color: rgba(255,255,255,0.75); }
    /* Main area */
    .adm-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
    .adm-topbar { background: #fff; border-bottom: 1px solid #e8ecf0; padding: 0 24px; height: 54px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
    .adm-topbar-title { font-size: 16px; font-weight: 700; color: #1a2332; font-family: 'Nunito', 'DM Sans', sans-serif; }
    .adm-body { flex: 1; overflow-y: auto; }
    /* Buttons */
    .btn { display: inline-flex; align-items: center; gap: 7px; padding: 8px 16px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; border: 1px solid #dde3ea; background: #fff; color: #1a2332; font-family: inherit; transition: all 0.12s; text-decoration: none; }
    .btn:hover { background: #f5f7fa; }
    .btn-primary { background: #1a6640; color: #fff; border-color: #1a6640; }
    .btn-primary:hover { background: #154f32; border-color: #154f32; }
    .btn-accent { background: #1a6640; color: #fff; border-color: #1a6640; }
    .btn-accent:hover { background: #154f32; }
    .btn-danger { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
    .btn-danger:hover { background: #fee2e2; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  `;

  function getCurrentPage() {
    const s = document.currentScript;
    if (s && s.getAttribute('data-page')) return s.getAttribute('data-page');
    const path = window.location.pathname.replace(/\/$/, '');
    if (path === '/admin') return 'dashboard';
    const seg = path.split('/').pop();
    return seg || 'dashboard';
  }

  function buildSidebar(activePage) {
    let html = `
      <div class="adm-sidebar">
        <div class="adm-logo">
          <div class="adm-brand"><div class="adm-dot"></div>blink premium</div>
          <div class="adm-sub">Administration</div>
        </div>
        <nav class="adm-nav">`;
    NAV.forEach(item => {
      if (item.section) {
        html += `<div class="adm-section">${item.section}</div>`;
      } else {
        const isActive = activePage === item.page;
        html += `<a href="${item.href}" class="adm-item${isActive ? ' active' : ''}">${item.label}</a>`;
      }
    });
    html += `
        </nav>
        <div class="adm-footer">
          <button class="adm-logout" id="adm-logout-btn">⬅ Déconnexion</button>
        </div>
      </div>`;
    return html;
  }

  function getPageTitle(activePage) {
    const item = NAV.find(n => n.page === activePage);
    return item ? item.label : document.title.split('—')[0].trim();
  }

  function inject() {
    // Inject Google Fonts (DM Sans + Nunito)
    if (!document.getElementById('adm-gfonts')) {
      const lp1 = document.createElement('link'); lp1.rel = 'preconnect'; lp1.href = 'https://fonts.googleapis.com';
      const lp2 = document.createElement('link'); lp2.rel = 'preconnect'; lp2.href = 'https://fonts.gstatic.com'; lp2.crossOrigin = '';
      const lf = document.createElement('link'); lf.id = 'adm-gfonts'; lf.rel = 'stylesheet';
      lf.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Nunito:wght@700;800;900&display=swap';
      document.head.append(lp1, lp2, lf);
    }
    // Inject CSS
    if (!document.getElementById('adm-sidebar-css')) {
      const style = document.createElement('style');
      style.id = 'adm-sidebar-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    const activePage = getCurrentPage();

    // Build wrap structure
    const wrap = document.createElement('div');
    wrap.className = 'adm-wrap';

    // Sidebar
    const sidebarEl = document.createElement('div');
    sidebarEl.innerHTML = buildSidebar(activePage);
    wrap.appendChild(sidebarEl.firstElementChild);

    // Main area
    const main = document.createElement('div');
    main.className = 'adm-main';

    // Topbar
    const topbar = document.createElement('div');
    topbar.className = 'adm-topbar';
    topbar.innerHTML = `<span class="adm-topbar-title">${getPageTitle(activePage)}</span>`;
    main.appendChild(topbar);

    // Body — move existing content
    const body_el = document.createElement('div');
    body_el.className = 'adm-body';
    // Move all body children (except scripts already run) into adm-body
    const children = Array.from(document.body.children);
    children.forEach(child => {
      if (child !== wrap) body_el.appendChild(child);
    });
    main.appendChild(body_el);

    wrap.appendChild(main);
    document.body.appendChild(wrap);

    // Logout handler
    const logoutBtn = document.getElementById('adm-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try { await fetch('/admin/api/auth/logout', { method: 'POST' }); } catch (_) {}
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_user');
        window.location.href = '/admin/login';
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
