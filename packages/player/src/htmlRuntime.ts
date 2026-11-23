/**
 * Script injected into every code layer (sandboxed iframe). It makes any HTML/CSS/JS animation seekable:
 * CSS animations, transitions and Web Animations are paused and moved to the requested time, GSAP's global
 * timeline too, and `greenlit.onFrame` handlers are called. The parent waits for "ready" before capturing a
 * frame, so renders are deterministic.
 */
export const HTML_RUNTIME = `
(() => {
  const g = (window.greenlit = { time: 0, props: {}, width: 0, height: 0, handlers: [], onFrame(fn) { this.handlers.push(fn); return () => { this.handlers = this.handlers.filter((h) => h !== fn) } } });
  // A painted frame when rAF runs, but never wait long for it (headless pages may throttle rAF).
  const raf = () => new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; r() } }; requestAnimationFrame(() => requestAnimationFrame(go)); setTimeout(go, 40) });
  // Moves every CSS / Web Animation and GSAP to t. Styles are flushed first; animations a frame only creates once it
  // paints are pinned after the first frame (see seek), so nothing ever runs in real time.
  function pin(t) {
    void (document.body || document.documentElement).getBoundingClientRect();
    for (const a of document.getAnimations()) { try { a.pause(); a.currentTime = t * 1000 } catch (e) {} }
    try { if (window.gsap && window.gsap.globalTimeline) { window.gsap.globalTimeline.pause(); window.gsap.globalTimeline.time(t, false) } } catch (e) {}
  }
  async function seek(t, props) {
    g.time = t; g.props = props || {};
    document.documentElement.style.setProperty('--t', String(t));
    pin(t);
    for (const h of g.handlers) { try { await h(t, g.props) } catch (e) { console.error(e) } }
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const imgs = [...document.images].filter((i) => !i.complete);
    await Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r })));
    pin(t);
    await raf();
    // A frame that has not painted yet (paint holding) creates its CSS animations on its first frame: pin those too.
    if (document.getAnimations().some((a) => a.playState !== 'paused' && a.playState !== 'finished')) {
      pin(t);
      await raf();
    }
  }
  addEventListener('message', async (e) => {
    const d = e.data || {};
    if (d.type !== 'greenlit:seek') return;
    g.width = d.width || g.width; g.height = d.height || g.height;
    await seek(d.t, d.props);
    parent.postMessage({ type: 'greenlit:ready', id: d.id, frame: d.frame }, '*');
  });
  addEventListener('error', (e) => parent.postMessage({ type: 'greenlit:error', message: String(e.message || e) }, '*'));
  const loaded = () => parent.postMessage({ type: 'greenlit:loaded' }, '*');
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', loaded); else loaded();
})();
`

/** Builds the iframe document: author code as-is if it is a full document, wrapped otherwise. */
export function htmlDocument(code: string, opts: { width: number; height: number; transparent: boolean }) {
  const base = `<style>html,body{margin:0;width:${opts.width}px;height:${opts.height}px;overflow:hidden;${opts.transparent ? 'background:transparent' : 'background:#000'}}*{box-sizing:border-box}</style>`
  const runtime = `<script>${HTML_RUNTIME}</script>`
  // The runtime goes first so author scripts can call greenlit.onFrame right away.
  if (/<html[\s>]/i.test(code)) {
    if (/<head[^>]*>/i.test(code)) return code.replace(/<head([^>]*)>/i, `<head$1>${base}${runtime}`)
    return code.replace(/<html([^>]*)>/i, `<html$1><head>${base}${runtime}</head>`)
  }
  return `<!doctype html><html><head><meta charset="utf-8">${base}${runtime}</head><body>${code}</body></html>`
}
