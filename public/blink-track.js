/* Blink Tracking — fonctionne dans WhatsApp in-app browser */
(function () {
  'use strict';

  var BASE = '';
  var _ready = false;
  var _queue = [];

  function _post(path, data) {
    try {
      fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      }).catch(function () {});
    } catch (_) {}
  }

  function _flush() {
    var q = _queue.splice(0);
    for (var i = 0; i < q.length; i++) {
      _post(q[i].path, q[i].data);
    }
  }

  function _pageView(extra) {
    var data = {
      page_url: window.location.href,
      referrer: document.referrer || null,
      metadata: extra || {},
    };
    if (_ready) {
      _post('/api/track/page-view', data);
    } else {
      _queue.push({ path: '/api/track/page-view', data: data });
    }
  }

  function _event(eventName, eventData) {
    var data = {
      event_name: eventName,
      event_data: eventData || {},
      page_url: window.location.href,
    };
    if (_ready) {
      _post('/api/track/event', data);
    } else {
      _queue.push({ path: '/api/track/event', data: data });
    }
  }

  // Expose public API
  window.BlinkTrack = {
    event: _event,
    pageView: _pageView,
  };

  // Auto page-view on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      _ready = true;
      _pageView();
      _flush();
    });
  } else {
    _ready = true;
    _pageView();
  }
})();
