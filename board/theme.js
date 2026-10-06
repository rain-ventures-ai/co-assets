// Runs in <head> before first paint so the chosen theme never flashes. Themes live in board.css as [data-theme="..."].
(function () {
  var THEMES = ['auto', 'light', 'dark', 'midnight', 'sand'];
  var saved = 'auto';
  try { saved = localStorage.getItem('kb_theme') || 'auto'; } catch (e) {}
  if (THEMES.indexOf(saved) < 0) saved = 'auto';
  document.documentElement.setAttribute('data-theme', saved);
  var STYLES = ['classic', 'colorful'], style = 'classic';
  try { style = localStorage.getItem('kb_style') || 'classic'; } catch (e) {}
  if (STYLES.indexOf(style) < 0) style = 'classic';
  document.documentElement.setAttribute('data-style', style);
  window.kbStyle = {
    set: function (s) { if (STYLES.indexOf(s) < 0) return; document.documentElement.setAttribute('data-style', s); try { localStorage.setItem('kb_style', s); } catch (e) {} },
    get: function () { return document.documentElement.getAttribute('data-style'); }
  };
  window.kbTheme = {
    list: THEMES,
    set: function (t) { if (THEMES.indexOf(t) < 0) return; document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('kb_theme', t); } catch (e) {} },
    get: function () { return document.documentElement.getAttribute('data-theme'); }
  };
})();
