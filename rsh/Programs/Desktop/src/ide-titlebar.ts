/** Windows workbench chrome; upstream navigation and layout actions remain mounted. */
export const ideTitlebarCss = `
.monaco-workbench .part.titlebar { -webkit-app-region: drag; }
.monaco-workbench .part.titlebar .window-appicon { display: none !important; }
.monaco-workbench .part.titlebar .titlebar-right { padding-right: 138px; box-sizing: border-box; }
.monaco-workbench .part.titlebar .titlebar-left { min-width: 220px; }
.monaco-workbench .part.titlebar .titlebar-center { min-width: 0; }
.monaco-workbench .part.titlebar .monaco-action-bar,
.monaco-workbench .part.titlebar .menubar,
.monaco-workbench .part.titlebar button { -webkit-app-region: no-drag; }
.rsh-window-menu { position: relative; z-index: 2501; display: inline-flex; align-items: center; gap: 9px; height: 28px; margin: 3px 8px;
  padding: 0 8px; color: var(--vscode-titleBar-activeForeground); background: transparent; border: 0;
  border-radius: 6px; font: 12px system-ui, sans-serif; white-space: nowrap; cursor: pointer; }
.rsh-window-menu::before { content: ''; width: 18px; height: 18px;
  background: url('/__rsh_titlebar/icon.svg') center / contain no-repeat; }
.rsh-window-menu::after { content: ''; width: 5px; height: 5px; margin-left: 4px;
  border-right: 1px solid currentColor; border-bottom: 1px solid currentColor; transform: translateY(-2px) rotate(45deg); }
.rsh-window-menu:hover { background: var(--vscode-toolbar-hoverBackground); }
.rsh-window-menu:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
@media (max-width: 1000px) {
  .monaco-workbench .part.titlebar .titlebar-left { min-width: 190px; }
}
`

/** Mount the branded application-menu button after the upstream workbench creates its title bar. */
export const ideTitlebarScript = `
(() => {
  const mount = () => {
    const target = document.querySelector('.part.titlebar .titlebar-left');
    if (!target) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rsh-window-menu';
    button.textContent = 'RedSpark Harness';
    button.setAttribute('aria-haspopup', 'menu');
    button.onclick = () => { fetch('/__rsh_titlebar/menu', { method: 'POST', headers: { 'x-rsh-workbench': '1' } }).catch(console.error); };
    target.prepend(button);
    observer.disconnect();
  };
  const observer = new MutationObserver(mount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  mount();
})();
`
