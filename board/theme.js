// Runs in <head> before first paint so the chosen theme never flashes. Themes live in board.css as [data-theme="..."].
(function () {
  var THEMES = ['auto', 'light', 'dark', 'midnight', 'sand'];
  var saved = 'auto';
  try { saved = localStorage.getItem('kb_theme') || 'auto'; } catch (e) {}
  if (THEMES.indexOf(saved) < 0) saved = 'auto';
  document.documentElement.setAttribute('data-theme', saved);
  window.kbTheme = {
    list: THEMES,
    set: function (t) { if (THEMES.indexOf(t) < 0) return; document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('kb_theme', t); } catch (e) {} },
    get: function () { return document.documentElement.getAttribute('data-theme'); }
  };
})();
