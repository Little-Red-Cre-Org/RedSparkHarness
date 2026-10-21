/** Scoped styles travel with the native application bundle, including Settings. */
export const conversationStyles = `
.rsh-native { --rsh-accent: #bd334b; --rsh-line: #e7e4e7; color: #292631; background: #faf9fb; font: 14px/1.6 "Segoe UI", "Microsoft YaHei", sans-serif; min-height: 100dvh; }
body:has(.rsh-native) { margin: 0; }
.rsh-native *, .rsh-native *::before, .rsh-native *::after { box-sizing: border-box; }
.rsh-native button, .rsh-native input, .rsh-native select, .rsh-native textarea { font: inherit; color: inherit; }
.rsh-native button { border: 1px solid var(--rsh-line); border-radius: 9px; background: white; padding: 8px 14px; cursor: pointer; }
.rsh-native button:hover:not(:disabled) { background: #f7edf0; border-color: #d8aab4; }
.rsh-native button:disabled { opacity: .45; cursor: default; }
.rsh-native :focus-visible { outline: 2px solid var(--rsh-accent); outline-offset: 3px; }
.rsh-native button.rsh-primary { color: white; background: var(--rsh-accent); border-color: var(--rsh-accent); }
.rsh-native button.rsh-primary:hover:not(:disabled) { background: #a7263e; }
.rsh-native select, .rsh-native input, .rsh-native textarea { max-width: 100%; border: 1px solid var(--rsh-line); border-radius: 8px; background: white; padding: 8px; }
.rsh-native textarea { resize: vertical; min-height: 100px; }
.rsh-native pre { font: 13px/1.8 Consolas, monospace; overflow: auto; }
.rsh-native h1, .rsh-native h2, .rsh-native p { margin-top: 0; }
.rsh-native [role="alert"] { padding: 12px; background: #fff0f1; color: #a11f39; border-radius: 8px; overflow-wrap: anywhere; }
.rsh-shell { display: grid; grid-template-columns: 248px minmax(0, 1fr); min-height: 100dvh; }
.rsh-sidebar { padding: 26px 18px; background: #f3f1f4; border-right: 1px solid var(--rsh-line); display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.rsh-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
.rsh-brand strong { font-size: 15px; }
.rsh-brand small { display: block; color: #77717e; font-size: 12px; }
.rsh-mark { font-size: 32px; color: var(--rsh-accent); }
.rsh-session-label { margin-top: 14px; color: #706a77; font-size: 12px; }
.rsh-sidebar-hint { font-size: 12px; color: #77717e; }
.rsh-settings-button { margin-top: auto; text-align: left; }
.rsh-workspace { min-width: 0; }
.rsh-topbar { height: 76px; padding: 0 32px; border-bottom: 1px solid var(--rsh-line); background: white; display: flex; align-items: center; justify-content: space-between; }
.rsh-topbar h1 { margin: 0; font-size: 16px; font-weight: 600; }
.rsh-status { margin: 0; color: #546958; background: #edf4ee; padding: 4px 12px; border-radius: 20px; font-size: 12px; }
.rsh-content { max-width: 980px; margin: auto; padding: 28px 36px; }
.rsh-welcome { min-height: calc(100dvh - 160px); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 36px 0 80px; }
.rsh-welcome-mark { display: grid; place-items: center; width: 72px; height: 72px; border-radius: 22px; color: var(--rsh-accent); background: #f7e8ec; font-size: 48px; margin-bottom: 24px; }
.rsh-welcome h2 { font-size: 28px; font-weight: 600; margin-bottom: 10px; }
.rsh-welcome p { color: #706a77; margin-bottom: 24px; }
.rsh-welcome small { color: #77717e; margin-top: 20px; }
.rsh-native fieldset { border: 1px solid var(--rsh-line); border-radius: 12px; padding: 14px; margin: 0 0 20px; display: flex; flex-wrap: wrap; gap: 12px; align-items: end; min-width: 0; }
.rsh-native legend { color: #706a77; font-size: 12px; padding: 0 6px; }
.rsh-native fieldset label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; min-width: 0; }
.rsh-transcript { min-height: 180px; }
.rsh-message { padding: 20px; border: 1px solid var(--rsh-line); border-radius: 14px; background: white; margin-bottom: 18px; }
.rsh-message-user { background: #f7edf0; border-color: #eddae0; }
.rsh-message strong { font-size: 12px; color: var(--rsh-accent); }
.rsh-native figure { margin: 12px 0; }
.rsh-records { color: #77717e; font-size: 12px; margin: 20px 0; }
.rsh-records summary { cursor: pointer; }
.rsh-composer { background: white; border: 1px solid #dcd5dd; border-radius: 16px; padding: 18px; box-shadow: 0 4px 20px #35203906; }
.rsh-composer > label:first-child { display: block; font-size: 12px; color: #706a77; }
.rsh-composer textarea { margin: 8px 0 14px; }
.rsh-composer > label:not(:first-child) { display: block; margin-bottom: 14px; }
.rsh-composer button { margin-right: 8px; }
.rsh-footnote { color: #77717e; font-size: 11px; margin-top: 12px; text-align: center; }
.rsh-settings { max-width: 1000px; margin: auto; padding: 32px; }
.rsh-settings h1 { font-size: 24px; }
.rsh-settings section { background: white; border: 1px solid var(--rsh-line); border-radius: 14px; padding: 20px; margin-top: 20px; }
.rsh-settings button { margin: 4px 8px 4px 0; }
@media (max-width: 700px) {
  .rsh-shell { grid-template-columns: minmax(0, 1fr); }
  .rsh-sidebar { border-right: 0; border-bottom: 1px solid var(--rsh-line); padding: 14px 18px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; }
  .rsh-brand { margin: 0; } .rsh-sidebar-hint, .rsh-session-label { display: none; }
  .rsh-settings-button { margin: 0; } .rsh-topbar { height: 58px; padding: 0 20px; }
  .rsh-content, .rsh-settings { padding: 20px 16px; }
  .rsh-welcome { min-height: 55dvh; padding: 36px 0; } .rsh-welcome h2 { font-size: 23px; }
}
`
