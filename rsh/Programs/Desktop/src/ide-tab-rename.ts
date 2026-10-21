/** Position the upstream rename field over the tab that opened its context menu. */
export const ideTabRenameScript = String.raw`(() => {
const install = () => {
  const style = document.createElement('style');
  style.textContent = '[data-rsh-tab-rename] { position: fixed !important; left: var(--rsh-rename-left) !important; top: var(--rsh-rename-top) !important; width: var(--rsh-rename-width) !important; margin: 0 !important; padding: 0 !important; } [data-rsh-tab-rename] .quick-input-titlebar, [data-rsh-tab-rename] .quick-input-message { display: none !important; } [data-rsh-tab-rename] .quick-input-header { padding: 0 !important; }';
  document.head.append(style);
  let tab;
  let pending = false;
  let anchor;
  let timer;
  document.addEventListener('contextmenu', event => {
    tab = event.target.closest?.('.tabs-container .tab');
    pending = Boolean(tab);
    anchor = tab?.getBoundingClientRect();
    clearTimeout(timer);
    timer = setTimeout(() => { pending = false; }, 30000);
  }, true);
  new MutationObserver(() => {
    if (!pending || !anchor) return;
    const input = document.querySelector('.quick-input-widget input');
    if (!input || !input.getClientRects().length || !['重命名', 'Rename'].includes(input.getAttribute('aria-label'))) return;
    const box = input.closest('.quick-input-widget');
    const rect = anchor;
    pending = false;
    clearTimeout(timer);
    requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!input.getClientRects().length) return;
    const previous = box.getAttribute('style');
    box.dataset.rshTabRename = 'true';
    box.style.setProperty('--rsh-rename-left', (rect.left + 8) + 'px');
    box.style.setProperty('--rsh-rename-top', (rect.top + 5) + 'px');
    box.style.setProperty('--rsh-rename-width', Math.max(120, Math.min(280, rect.width - 16)) + 'px');
    Object.assign(box.style, {
      position: 'fixed', left: (rect.left + 8) + 'px', top: (rect.top + 5) + 'px',
      width: Math.max(120, Math.min(280, rect.width - 16)) + 'px',
      height: 'auto', zIndex: '10000', margin: '0', padding: '0',
      background: 'var(--vscode-input-background)',
    });
    const restore = () => {
      const display = box.style.display;
      if (previous === null) box.removeAttribute('style'); else box.setAttribute('style', previous);
      box.style.display = display;
      delete box.dataset.rshTabRename;
      tab = undefined;
    };
    const closeObserver = new MutationObserver(() => {
      if (box.style.display !== 'none') return;
      closeObserver.disconnect();
      restore();
    });
    closeObserver.observe(box, { attributes: true, attributeFilter: ['style'] });
    }));
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true }); else install();
})();`
