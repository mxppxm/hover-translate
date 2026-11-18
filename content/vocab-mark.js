(() => {
  // 网页里出现生词本中的词时轻微标出。用 CSS Custom Highlight API，不改页面 DOM。
  if (window.__htVocabMark || typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
  window.__htVocabMark = true;

  const NAME = 'ht-vocab';
  const MAX_NODES = 20000;
  const MAX_RANGES = 3000;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'CODE', 'PRE', 'SVG', 'MATH', 'TITLE']);

  let enabled = true;
  let pattern = null;
  let styleEl = null;
  let timer = null;
  let observer = null;

  function buildPattern(vocab) {
    const words = Object.values(vocab || {})
      .map((e) => String(e?.word || '').trim())
      .filter((w) => w.length >= 2 && /^[A-Za-z][A-Za-z'’ -]*$/.test(w));
    if (!words.length) return null;
    const alts = [...new Set(words.map((w) => w.toLowerCase()))]
      .sort((a, b) => b.length - a.length)
      .map((w) => {
        const e = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
        return w.endsWith('e') ? `(?:${e}|${e.slice(0, -1)})` : e;
      });
    return new RegExp(`\\b(?:${alts.join('|')})(?:s|es|ed|d|ing)?\\b`, 'gi');
  }

  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return;
    styleEl = document.createElement('style');
    styleEl.textContent = `::highlight(${NAME}) { background-color: rgba(251, 191, 36, .22); text-decoration: underline dotted rgba(217, 119, 6, .9); text-underline-offset: 3px; }`;
    (document.head || document.documentElement).appendChild(styleEl);
  }

  function scan() {
    timer = null;
    if (!enabled || !pattern || !document.body) {
      CSS.highlights.delete(NAME);
      return;
    }
    const ranges = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || SKIP.has(p.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
        if (p.isContentEditable) return NodeFilter.FILTER_REJECT;
        if (p.closest('[id^="__hover_translate"]')) return NodeFilter.FILTER_REJECT;
        return node.data.trim().length >= 2 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let n = 0;
    let node;
    while ((node = walker.nextNode()) && n++ < MAX_NODES && ranges.length < MAX_RANGES) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(node.data)) && ranges.length < MAX_RANGES) {
        const r = new Range();
        r.setStart(node, m.index);
        r.setEnd(node, m.index + m[0].length);
        ranges.push(r);
      }
    }
    if (!ranges.length) {
      CSS.highlights.delete(NAME);
      return;
    }
    ensureStyle();
    CSS.highlights.set(NAME, new Highlight(...ranges));
  }

  function schedule(delay = 1200) {
    if (timer) return;
    timer = setTimeout(scan, delay);
  }

  function watch() {
    if (observer || !document.body) return;
    observer = new MutationObserver(() => schedule());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function apply(vocab, config) {
    enabled = config?.markVocab !== false;
    pattern = enabled ? buildPattern(vocab) : null;
    if (pattern) watch();
    else if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearTimeout(timer);
    timer = null;
    scan();
  }

  chrome.storage.local
    .get(['vocab', 'config'])
    .then(({ vocab, config }) => apply(vocab, config))
    .catch(() => {});

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || (!changes.vocab && !changes.config)) return;
    chrome.storage.local.get(['vocab', 'config']).then(({ vocab, config }) => apply(vocab, config)).catch(() => {});
  });
})();
