/** Pending AI replacements and explicit user acceptance in the conversation sidebar. */
import * as vscode from 'vscode'
import { randomBytes } from 'node:crypto'
import { applyReviewBlocks, codeReviewBlocks, type CodeReviewBlock } from './ide-code-review.ts'
import type { workbenchMessages } from './ide-locale.ts'

type Messages = ReturnType<typeof workbenchMessages>
interface Baseline { document: vscode.TextDocument; text: string; version: number }
interface Review extends Baseline {
  id: string; sessionId: string; blocks: CodeReviewBlock[]; accepted: Set<number>; expected: string; busy: boolean; error?: string
}

/**
 * Hold proposed code outside editor documents until explicit acceptance.
 * @param currentEditor - last focused code editor.
 * @param post - owning webview transport.
 * @param t - localized control labels and errors.
 * @returns message handlers owned by the extension view.
 */
export function createCodeReview(currentEditor: () => vscode.TextEditor | undefined, post: (value: Record<string, unknown>) => void, t: Messages) {
  const baselines = new Map<string, Baseline | undefined>()
  let review: Review | undefined
  let selected: string | undefined
  const publish = (): void => {
    post({ type: 'review-state', review: review !== undefined && review.sessionId === selected ? {
      id: review.id, name: vscode.workspace.asRelativePath(review.document.uri), blocks: review.blocks,
      accepted: [...review.accepted], busy: review.busy, error: review.error,
    } : null })
  }
  return {
    select(sessionId: string | undefined): void { selected = sessionId; publish() },
    prepare(sessionId: string, requestId: string): void {
      if (review !== undefined) {
        post({ type: 'prepared-code', requestId, error: t.reviewPending }); return
      }
      const document = currentEditor()?.document
      const text = document !== undefined && !document.isClosed ? document.getText() : ''
      baselines.set(sessionId, text === '' || document === undefined ? undefined : { document, text, version: document.version })
      post({ type: 'prepared-code', requestId, text, path: document?.uri.toString() ?? '', language: document?.languageId ?? '' })
    },
    propose(sessionId: string, candidates: readonly { content: string }[]): boolean {
      if (!baselines.has(sessionId)) return true
      const baseline = baselines.get(sessionId)
      baselines.delete(sessionId)
      if (baseline === undefined) return false
      if (candidates.length !== 1) {
        void vscode.window.showWarningMessage(t.reviewSingleFile); return true
      }
      const newline = baseline.text.includes('\r\n') ? '\r\n' : '\n'
      let proposed = candidates[0]!.content.replace(/\r?\n/g, newline)
      if (baseline.text.endsWith('\n') && !proposed.endsWith('\n')) proposed += newline
      const blocks = codeReviewBlocks(baseline.text, proposed)
      if (blocks.length === 0) { void vscode.window.showInformationMessage(t.reviewUnchanged); return true }
      review = { ...baseline, id: randomBytes(16).toString('hex'), sessionId, blocks, accepted: new Set(), expected: baseline.text, busy: false }
      publish()
      return true
    },
    async act(id: string, action: string, index?: number): Promise<void> {
      const entry = review
      if (entry === undefined || entry.id !== id || entry.sessionId !== selected || entry.busy) return
      if (action === 'discard') { review = undefined; publish(); return }
      if (action !== 'all' && (action !== 'accept' || index === undefined || !Number.isInteger(index)
        || index < 0 || index >= entry.blocks.length || entry.accepted.has(index))) return
      entry.busy = true
      publish()
      try {
        const editor = await vscode.window.showTextDocument(entry.document, { viewColumn: vscode.ViewColumn.One, preview: false, preserveFocus: true })
        if (entry.document.isClosed || entry.document.version !== entry.version || entry.document.getText() !== entry.expected) throw new Error(t.reviewConflict)
        const accepted = new Set(entry.accepted)
        if (action === 'all') entry.blocks.forEach((_, i) => accepted.add(i))
        else accepted.add(index!)
        const text = applyReviewBlocks(entry.text, entry.blocks, accepted)
        const range = new vscode.Range(entry.document.positionAt(0), entry.document.positionAt(entry.expected.length))
        if (!await editor.edit(edit => edit.replace(range, text))) throw new Error(t.reviewConflict)
        entry.accepted = accepted; entry.expected = text; entry.version = entry.document.version
        if (accepted.size === entry.blocks.length) review = undefined
      } catch (error) { entry.error = String(error) }
      finally { entry.busy = false; publish() }
    },
  }
}

/**
 * Render the review controls beside the conversation; code is always textContent.
 * @param t - localized review labels.
 * @returns script executed by the owning isolated webview.
 */
export function codeReviewScript(t: Messages): string {
  return `
  const labels=${JSON.stringify(t)},reviewPanel=document.getElementById('code-review');
  function renderReview(review){
    reviewPanel.replaceChildren();reviewPanel.hidden=!review;if(!review)return;
    const title=document.createElement('strong');title.textContent=labels.reviewTitle+' · '+review.name;reviewPanel.append(title);
    const send=(action,index)=>api.postMessage({type:'review-action',channel,id:review.id,action,index});
    const button=(label,action,index)=>{const b=document.createElement('button');b.textContent=label;b.disabled=review.busy||(!!review.error&&action!=='discard');b.onclick=()=>send(action,index);return b;};
    const controls=document.createElement('div');controls.append(button(labels.reviewAll,'all'),button(labels.reviewDiscard,'discard'));reviewPanel.append(controls);
    if(review.error){const error=document.createElement('p');error.textContent=review.error;error.setAttribute('role','alert');reviewPanel.append(error);}
    review.blocks.forEach((block,index)=>{
      const section=document.createElement('section');section.className='review-block';
      const accepted=review.accepted.includes(index),heading=document.createElement('div');heading.textContent=labels.reviewBlock+' '+(index+1)+(accepted?' · '+labels.reviewAccepted:'');section.append(heading);
      for(const [label,text,kind] of [[labels.before,block.before,'before'],[labels.after,block.after,'after']]){
        const caption=document.createElement('small');caption.textContent=label;const pre=document.createElement('pre');pre.className=kind;pre.textContent=text;section.append(caption,pre);
      }
      if(!accepted)section.append(button(labels.reviewAccept,'accept',index));reviewPanel.append(section);
    });
  }`
}
