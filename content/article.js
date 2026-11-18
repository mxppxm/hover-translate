(() => {
  // 自动识别页面正文：找出承载大部分段落文字的容器，按文档顺序取出段落和小标题。
  // 只读 DOM，不改页面。是否为英文、分句等判断交给后台（shared/deep.js 的 prepareArticle）。
  if (window.__htArticle || window !== window.top) return;

  const MAX_BLOCKS = 400;
  const TEXT_BLOCKS = 'p, li, blockquote, dd, figcaption, h1, h2, h3, h4, h5, h6';
  const LOOSE_BLOCKS = 'div, td, section';
  const SKIP =
    'nav, footer, aside, form, button, select, textarea, pre, code, script, style, noscript, svg, ' +
    '[role="navigation"], [role="complementary"], [role="search"], [role="dialog"], [aria-hidden="true"], [id^="__hover_translate"]';
  const NOISE = /(?:^|[\s_-])(?:comments?|sidebar|footer|related|promo|share|sharing|social|advert\w*|ads?|newsletter|subscribe|cookies?|breadcrumbs?|menu|nav|popup|modal|recommend\w*|toolbar|byline|author-bio)(?:$|[\s_-])/i;

  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => el.getClientRects().length > 0;

  function directTextLength(el) {
    let n = 0;
    for (const node of el.childNodes) if (node.nodeType === 3) n += node.data.trim().length;
    return n;
  }

  // 用来给容器打分的「像正文的段落」
  function scoringParagraphs() {
    const pick = (selector, test) =>
      [...document.body.querySelectorAll(selector)].filter((el) => !el.closest(SKIP) && visible(el) && test(el));
    const ps = pick('p', (el) => norm(el.textContent).length >= 60);
    const total = ps.reduce((n, el) => n + norm(el.textContent).length, 0);
    if (total >= 400) return ps;
    // 不用 <p> 排版的页面（div + br、表格布局）：退回到「自身直接带大段文字」的元素
    return ps.concat(pick(LOOSE_BLOCKS, (el) => directTextLength(el) >= 80 && !el.querySelector('p')));
  }

  function findContainer(paragraphs) {
    const score = new Map();
    const leaves = new Set(paragraphs);
    for (const el of paragraphs) {
      const len = norm(el.textContent).length;
      for (let a = el.parentElement; a; a = a.parentElement) {
        score.set(a, (score.get(a) || 0) + len);
        if (a === document.body) break;
      }
    }
    // 从 body 往下走：只要某个子元素独占了大部分正文，就继续往里收窄
    let node = document.body;
    for (;;) {
      const own = score.get(node) || 0;
      let best = null;
      for (const child of node.children) {
        if (leaves.has(child)) continue;
        if ((score.get(child) || 0) > (score.get(best) || 0)) best = child;
      }
      if (!best || (score.get(best) || 0) < own * 0.6) break;
      node = best;
    }
    return node;
  }

  function noisy(el, container, memo) {
    if (!el || el === container) return false;
    if (memo.has(el)) return memo.get(el);
    const label = `${typeof el.className === 'string' ? el.className : ''} ${el.id || ''}`;
    const bad = NOISE.test(label) || noisy(el.parentElement, container, memo);
    memo.set(el, bad);
    return bad;
  }

  function extract() {
    if (!document.body) return { title: document.title, blocks: [], els: [] };
    const container = findContainer(scoringParagraphs());
    const memo = new Map();
    const blocks = [];
    const els = [];
    for (const el of container.querySelectorAll(`${TEXT_BLOCKS}, ${LOOSE_BLOCKS}`)) {
      if (blocks.length >= MAX_BLOCKS) break;
      const tag = el.tagName;
      const heading = /^H[1-6]$/.test(tag);
      const loose = tag === 'DIV' || tag === 'TD' || tag === 'SECTION';
      if (loose ? directTextLength(el) < 80 || el.querySelector(TEXT_BLOCKS) : el.querySelector(TEXT_BLOCKS)) continue;
      if (el.closest(SKIP) || !visible(el) || noisy(el, container, memo)) continue;
      const text = norm(el.innerText || el.textContent);
      if (text.length < (heading ? 2 : tag === 'LI' ? 40 : 25)) continue;
      blocks.push({ kind: heading ? 'h' : 'p', text });
      els.push(el);
    }
    return { title: norm(document.title), blocks, els };
  }

  window.__htArticle = { extract };
})();
