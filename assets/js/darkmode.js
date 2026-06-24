// Shared dark/light mode toggle. Works on any page:
// - Applies the saved preference immediately.
// - Wires the #mode-toggle button if present.
(function () {
  const html = document.documentElement;
  const btn  = document.getElementById('mode-toggle');
  const icon = btn ? btn.querySelector('i') : null;

  function isDark() {
    const mode = html.dataset.mode;
    if (mode === 'dark')  return true;
    if (mode === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyMode(dark) {
    html.dataset.mode = dark ? 'dark' : 'light';
    if (icon) icon.className = dark ? 'ph ph-sun' : 'ph ph-moon';
    if (btn)  btn.title      = dark ? 'Switch to light mode' : 'Switch to dark mode';
    try { localStorage.setItem('caco3-mode', dark ? 'dark' : 'light'); } catch (_) {}
  }

  const saved = (() => { try { return localStorage.getItem('caco3-mode'); } catch (_) { return null; } })();
  applyMode(saved ? saved === 'dark' : isDark());

  if (btn) btn.addEventListener('click', () => applyMode(!isDark()));
})();
