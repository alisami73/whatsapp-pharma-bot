(function () {
  const token = localStorage.getItem('admin_token');
  if (!token) { window.location.href = '/admin/login'; return; }

  // Intercept all /admin/ fetch calls to add Authorization header automatically
  const _fetch = window.fetch;
  window.fetch = function (url, opts) {
    if (typeof url === 'string' && (url.startsWith('/admin/') || url.startsWith('/admin'))) {
      opts = Object.assign({}, opts);
      opts.headers = Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {});
    }
    return _fetch.call(this, url, opts);
  };

  // Verify session is still valid
  _fetch('/admin/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
    .then(function (r) {
      if (!r.ok) { localStorage.removeItem('admin_token'); localStorage.removeItem('admin_user'); window.location.href = '/admin/login'; }
    })
    .catch(function () { window.location.href = '/admin/login'; });
})();
