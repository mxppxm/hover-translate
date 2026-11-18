(() => {
  if (window.__htDeep) return;
  const IS_TOP = window === window.top;
  const HOST_ID = '__hover_translate_deep__';

  const ROLE_LABEL = {
    subject: '主语',
    verb: '谓语',
    object: '宾语/表语',
    clause: '从句',
    nonfinite: '非谓语',
    insert: '插入语'
  };

  const svg = (body, fill = 'none') =>
    `<svg viewBox="0 0 24 24" width="15" height="15" fill="${fill}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICONS = {
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    speak: svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
    retry: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>')
  };

  let cfg = { speakRate: 1, speakVoice: '', showIpa: true };
  chrome.storage.local
    .get('config')
    .then(({ config }) => {
      cfg = { ...cfg, ...(config || {}) };
    })
    .catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.config) cfg = { ...cfg, ...(changes.config.newValue || {}) };
  });

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .panel {
      position: fixed; top: 0; right: 0; height: 100vh; width: 420px; max-width: 100vw;
      display: flex; flex-direction: column;
      background: #fff; color: #1f2937;
      border-left: 1px solid #e5e7eb; box-shadow: -12px 0 32px rgba(15,23,42,.12);
      font: 13px/1.65 -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
      transform: translateX(0); transition: transform .18s ease;
    }
    .panel.hidden { transform: translateX(105%); }
    button { font: inherit; color: inherit; }
    .head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 10px 16px; border-bottom: 1px solid #eef0f4; }
    .title { font-size: 15px; font-weight: 600; }
    .meta { flex: 1; min-width: 0; color: #9ca3af; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .icon {
      display: inline-flex; align-items: center; justify-content: center; flex: none;
      width: 26px; height: 26px; border: 0; background: transparent; color: #6b7280; cursor: pointer; border-radius: 6px;
    }
    .icon:hover { background: #f3f4f6; color: #111827; }
    .icon.on { color: #2563eb; }
    .tabs { display: flex; gap: 4px; padding: 8px 12px; border-bottom: 1px solid #eef0f4; }
    .tab { border: 0; background: transparent; padding: 3px 10px; border-radius: 7px; color: #6b7280; cursor: pointer; }
    .tab:hover { background: #f3f4f6; }
    .tab.on { background: #eef2ff; color: #4338ca; font-weight: 600; }
    .tab[hidden] { display: none; }
    .body { position: relative; flex: 1; overflow-y: auto; padding: 12px 14px 40px; }
    .view[hidden] { display: none; }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11.5px; color: #6b7280; margin: 0 2px 10px; }
    .legend span { display: inline-flex; align-items: center; gap: 4px; }
    .legend i { display: inline-block; width: 14px; height: 9px; border-radius: 2px; }
    .error-box { color: #b91c1c; background: #fef2f2; border: 1px solid #fee2e2; border-radius: 10px; padding: 10px 12px; }

    .sent { border: 1px solid #eceef3; border-radius: 12px; padding: 10px 12px 12px; margin-bottom: 10px; }
    .sent-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; color: #9ca3af; font-size: 11.5px; }
    .num { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; background: #f3f4f6; color: #6b7280; font-size: 11px; }
    .diff { flex: 1; letter-spacing: 1px; }
    .from-cache { font-size: 11px; color: #a5b4fc; }
    .en { font: 15px/1.95 Georgia, "Times New Roman", serif; color: #111827; word-break: break-word; }
    .zh { color: #4b5563; margin-top: 6px; }
    .sec { margin-top: 10px; }
    .sec-t { font-size: 11.5px; font-weight: 600; color: #9ca3af; margin-bottom: 3px; letter-spacing: .5px; }
    .read { color: #374151; }
    .pill { display: inline-block; background: #f5f6f8; border-radius: 6px; padding: 1px 8px; margin: 2px 4px 2px 0; }
    .pill b { font-weight: 600; margin-right: 4px; }
    .gram { padding-left: 16px; color: #374151; }
    .skel { height: 10px; border-radius: 5px; background: linear-gradient(90deg,#f1f3f6 25%,#e7eaef 50%,#f1f3f6 75%); background-size: 200% 100%; animation: sh 1.2s infinite linear; margin-top: 8px; }
    .skel.w2 { width: 70%; }
    @keyframes sh { from { background-position: 200% 0 } to { background-position: -200% 0 } }
    .sent-err { margin-top: 8px; color: #b91c1c; display: flex; align-items: center; gap: 8px; }
    .btn-link { border: 0; background: transparent; color: #4f46e5; cursor: pointer; padding: 0; }
    .btn-link:hover { text-decoration: underline; }

    .r { box-decoration-break: clone; -webkit-box-decoration-break: clone; }
    .r-subject { border-bottom: 2px solid #2563eb; }
    .r-verb { border-bottom: 2px solid #dc2626; font-weight: 600; }
    .r-object { border-bottom: 2px solid #059669; }
    .r-clause { background: #f3ecff; border-radius: 3px; padding: 1px 0; }
    .r-nonfinite { background: #fff1d6; border-radius: 3px; padding: 1px 0; }
    .r-insert { background: #eef1f5; border-radius: 3px; font-style: italic; }
    .plain .r { border: 0; background: transparent; font-weight: inherit; font-style: inherit; }
    .tok { cursor: pointer; border-radius: 3px; }
    .tok:hover { background: rgba(99,102,241,.14); }
    .tok.sel { background: rgba(99,102,241,.22); }

    .word { display: flex; align-items: flex-start; gap: 8px; padding: 7px 0; border-top: 1px dashed #eceef3; }
    .word:first-of-type { border-top: 0; }
    .word-main { flex: 1; min-width: 0; }
    .w { font-weight: 600; font-size: 14px; }
    .ipa { color: #9ca3af; font-size: 12px; margin-left: 6px; }
    .pos { color: #6366f1; font-size: 12px; margin-left: 6px; }
    .common { color: #9ca3af; font-size: 12px; }
    .src-sent { color: #9ca3af; font-size: 12px; margin-top: 2px; }
    .add {
      flex: none; border: 1px solid #c7d2fe; background: #fff; color: #4f46e5; border-radius: 999px;
      padding: 1px 10px; font-size: 12px; cursor: pointer; white-space: nowrap;
    }
    .add:hover { background: #eef2ff; }
    .add.on { border-color: #bbf7d0; color: #047857; background: #f0fdf4; }
    .empty { color: #9ca3af; text-align: center; padding: 30px 0; }
    .gist { font-size: 14px; color: #111827; background: #f8f9fc; border-radius: 10px; padding: 12px 14px; }
    .flow { margin-top: 12px; padding-left: 18px; color: #374151; }
    .flow li { margin: 4px 0; }

    .art-bar { display: flex; align-items: center; gap: 8px; margin: 0 2px 8px; color: #6b7280; font-size: 12px; }
    .art-title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chip { flex: none; border: 1px solid #e5e7eb; background: #fff; color: #6b7280; border-radius: 999px; padding: 0 10px; font-size: 11.5px; cursor: pointer; }
    .chip.on { border-color: #c7d2fe; background: #eef2ff; color: #4338ca; }
    .art-gist { background: #f8f9fc; border-radius: 10px; padding: 9px 12px; margin-bottom: 10px; color: #374151; }
    .art-gist[hidden] { display: none; }
    .art-h { font: 600 15px/1.5 Georgia, "Times New Roman", serif; color: #111827; margin: 18px 2px 8px; }
    .para { margin-bottom: 14px; padding-left: 8px; border-left: 2px solid transparent; }
    .para.cur { border-left-color: #6366f1; }
    .para-head { display: flex; width: 100%; align-items: center; gap: 8px; border: 0; background: transparent; color: #9ca3af; font-size: 11.5px; padding: 0 0 4px; cursor: pointer; text-align: left; }
    .para-head .jump { margin-left: auto; visibility: hidden; }
    .para-head:hover { color: #4f46e5; }
    .para-head:hover .jump { visibility: visible; }
    .sent.idle { border-style: dashed; }
    .sec-row { display: block; width: 100%; text-align: left; border: 1px solid #eceef3; background: #fff; border-radius: 10px; padding: 8px 12px; margin-top: 8px; cursor: pointer; }
    .sec-row:hover { border-color: #c7d2fe; background: #fafbff; }
    .sec-row b { font-weight: 600; color: #111827; }
    .sec-row .rng { float: right; color: #9ca3af; font-size: 11.5px; }
    .sec-row div { color: #4b5563; margin-top: 2px; }

    .pop {
      position: absolute; z-index: 5; width: 280px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
      box-shadow: 0 10px 28px rgba(15,23,42,.16); padding: 10px 12px;
    }
    .pop[hidden] { display: none; }
    .pop-row { display: flex; align-items: center; gap: 6px; }
    .pop-row .w { flex: 1; }
    .pop .mean { margin-top: 4px; color: #111827; }
    .pop .loading { color: #9ca3af; }
  `;

  let host = null;
  let root = null;
  let ui = null;
  let port = null;
  let state = null;
  let added = {};

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const key = (w) => String(w || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(res || { ok: false });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    });
  }

  function ensureUi() {
    if (host) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;top:0;right:0;width:0;height:0;z-index:2147483647;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
      <aside class="panel hidden" role="complementary" aria-label="精读">
        <div class="head">
          <span class="title">精读</span>
          <span class="meta"></span>
          <button class="icon act-close" title="关闭（Esc）">${ICONS.close}</button>
        </div>
        <div class="tabs">
          <button class="tab on" data-tab="sents">逐句</button>
          <button class="tab" data-tab="words">词汇</button>
          <button class="tab" data-tab="gist">主旨</button>
        </div>
        <div class="body">
          <div class="view" data-view="sents"></div>
          <div class="view" data-view="words" hidden></div>
          <div class="view" data-view="gist" hidden></div>
          <div class="pop" hidden></div>
        </div>
      </aside>`;
    (document.body || document.documentElement).appendChild(host);
    const $ = (s) => root.querySelector(s);
    ui = {
      panel: $('.panel'),
      meta: $('.meta'),
      body: $('.body'),
      tabs: [...root.querySelectorAll('.tab')],
      sents: $('[data-view="sents"]'),
      words: $('[data-view="words"]'),
      gist: $('[data-view="gist"]'),
      pop: $('.pop')
    };
    $('.act-close').addEventListener('click', close);
    ui.tabs.forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    ui.body.addEventListener('click', onBodyClick);
    ui.body.addEventListener(
      'scroll',
      () => {
        hidePop();
        schedulePump(400);
      },
      { passive: true }
    );
    // 捕获阶段才能收到页面里嵌套滚动容器的 scroll
    window.addEventListener('scroll', onPageScroll, { passive: true, capture: true });
  }

  function switchTab(name) {
    ui.tabs.forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
    root.querySelectorAll('.view').forEach((v) => {
      v.hidden = v.dataset.view !== name;
    });
    hidePop();
    if (name === 'words') renderWords();
    if (name === 'sents') schedulePump(200);
  }

  function isOpen() {
    return !!ui && !ui.panel.classList.contains('hidden');
  }

  function close() {
    if (!ui) return;
    ui.panel.classList.add('hidden');
    hidePop();
    stopSpeak();
    dropPort();
    highlightPage(null);
  }

  function dropPort() {
    const p = port;
    port = null;
    if (!p) return;
    try {
      p.disconnect();
    } catch (_) {}
  }

  function connect() {
    if (port) return port;
    const p = chrome.runtime.connect({ name: 'ht-deep' });
    port = p;
    p.onMessage.addListener((msg) => {
      if (port === p) onPortMessage(msg);
    });
    p.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (port !== p) return;
      port = null;
      onPortLost();
    });
    return p;
  }

  // 后台被回收时，还在等结果的句子不会再有回音，改成可重试的失败
  function onPortLost() {
    if (state?.mode !== 'article') return;
    state.status.forEach((st, i) => {
      if (st !== 'pending') return;
      state.status[i] = 'error';
      state.errors[i] = '连接中断';
      renderSentence(i);
    });
    if (!state.gist && !state.gistError && state.items) {
      state.gistError = '连接中断，导读没有取回';
      renderGist();
    }
  }

  function newState(mode, extra) {
    clearTimeout(articleTimer);
    clearTimeout(pumpTimer);
    dropPort();
    highlightPage(null);
    return { mode, sentences: [], results: [], errors: [], status: [], gist: null, gistError: '', done: false, foot: '', ...extra };
  }

  function show(text) {
    const src = String(text || '').replace(/\s+/g, ' ').trim();
    if (!src) return;
    ensureUi();
    state = newState('selection', { text: src });
    hidePop();
    ui.sents.innerHTML = '<div class="sent"><div class="skel"></div><div class="skel w2"></div></div>';
    ui.words.innerHTML = '';
    ui.gist.innerHTML = '';
    ui.meta.textContent = '分析中…';
    switchTab('sents');
    gistTab().textContent = '主旨';
    gistTab().hidden = true;
    ui.panel.classList.remove('hidden');
    ui.body.scrollTop = 0;
    connect().postMessage({ type: 'start', text: src });
  }

  const gistTab = () => ui.tabs.find((t) => t.dataset.tab === 'gist');

  // ---- 全文精读：自动识别正文，随阅读位置逐段分析 ----
  const PUMP_MAX_SENTENCES = 10;
  const HL = 'ht-reading';
  let follow = true;
  let pumpTimer = null;
  let followTimer = null;
  let articleTimer = null;
  let followMuteUntil = 0;
  let hlStyle = null;

  async function showArticle() {
    if (!IS_TOP) return;
    ensureUi();
    const found = window.__htArticle ? window.__htArticle.extract() : { title: document.title, blocks: [], els: [] };
    const mine = (state = newState('article', { title: found.title || '', items: null, active: -1 }));
    hidePop();
    ui.sents.innerHTML = '<div class="sent"><div class="skel"></div><div class="skel w2"></div></div>';
    ui.words.innerHTML = '';
    ui.gist.innerHTML = '<div class="skel"></div><div class="skel w2"></div>';
    ui.meta.textContent = '识别正文…';
    switchTab('sents');
    gistTab().textContent = '导读';
    gistTab().hidden = true;
    ui.panel.classList.remove('hidden');
    ui.body.scrollTop = 0;

    const res = await send({ type: 'HT_ARTICLE_PREPARE', blocks: found.blocks });
    if (state !== mine) return;
    if (!res?.ok) {
      ui.sents.innerHTML = `<div class="error-box">${esc(res?.error || '没有识别出正文')}</div>`;
      ui.meta.textContent = '';
      return;
    }
    state.items = res.items.map((it) => ({ ...it, el: found.els[it.src] || null }));
    state.sentences = res.sentences;
    state.truncated = !!res.truncated;
    state.paraItems = [];
    state.sentPara = [];
    state.items.forEach((it, k) => {
      if (it.kind !== 'p') return;
      state.paraItems.push(k);
      for (let i = it.from; i < it.to; i++) state.sentPara[i] = k;
    });
    gistTab().hidden = false;
    renderArticle();
    updateMeta();
    connect().postMessage({ type: 'outline', title: state.title, items: state.items.map(({ kind, text }) => ({ kind, text })) });
    // 从页面当前读到的位置开始，而不是总从第一段开始
    setActive(activeFromPage(), 'auto');
    schedulePump(250);
  }

  function renderArticle() {
    let pn = 0;
    const body = state.items
      .map((it, k) => {
        if (it.kind === 'h') return `<div class="art-h" data-ctx="${esc(it.text)}">${tokensHtml(it.text)}</div>`;
        pn++;
        let sents = '';
        for (let i = it.from; i < it.to; i++) sents += `<div class="sent" data-i="${i}"></div>`;
        return `<div class="para" data-b="${k}">
          <button class="para-head" data-jump="${k}" title="在原文中定位这一段"><span>第 ${pn} 段 · ${it.to - it.from} 句</span><span class="jump">定位原文</span></button>
          ${sents}</div>`;
      })
      .join('');
    ui.sents.innerHTML =
      `<div class="art-bar"><span class="art-title" title="${esc(state.title)}">${esc(state.title)}</span>` +
      `<button class="chip${follow ? ' on' : ''}" data-follow title="滚动网页时，侧栏自动跟到正在读的那一段">跟随原文</button></div>` +
      '<div class="art-gist" hidden></div>' +
      legendHtml() +
      body +
      (state.truncated ? '<div class="empty">文章太长，后面的部分没有载入</div>' : '');
    state.sentences.forEach((_, i) => renderSentence(i));
  }

  function requestSentences(indices) {
    const items = indices.map((i) => {
      const it = state.items[state.sentPara[i]];
      state.status[i] = 'pending';
      state.errors[i] = '';
      renderSentence(i);
      return {
        index: i,
        sentence: state.sentences[i],
        prev: i > it.from ? state.sentences[i - 1] : '',
        next: i + 1 < it.to ? state.sentences[i + 1] : ''
      };
    });
    connect().postMessage({ type: 'analyze', items });
  }

  function schedulePump(delay = 300) {
    clearTimeout(pumpTimer);
    pumpTimer = setTimeout(pump, delay);
  }

  // 只分析侧栏里看得到的段落，外加往后预取一段；上一批没回来之前不发下一批
  function pump() {
    pumpTimer = null;
    if (!isOpen() || state?.mode !== 'article' || !state.items || ui.sents.hidden) return;
    if (state.status.some((st) => st === 'pending')) return;
    const view = ui.body.getBoundingClientRect();
    const picked = [];
    let ahead = 0;
    for (const block of ui.sents.querySelectorAll('.para')) {
      const r = block.getBoundingClientRect();
      if (r.bottom <= view.top + 4) continue;
      if (r.top >= view.bottom - 4 && ++ahead > 1) break;
      const it = state.items[Number(block.dataset.b)];
      const todo = [];
      for (let i = it.from; i < it.to; i++) if (!state.status[i]) todo.push(i);
      if (!todo.length) continue;
      if (picked.length && picked.length + todo.length > PUMP_MAX_SENTENCES) break;
      picked.push(...todo);
    }
    if (picked.length) requestSentences(picked);
  }

  function activeFromPage() {
    const line = window.innerHeight * 0.3;
    let last = -1;
    for (const k of state.paraItems) {
      const el = state.items[k].el;
      if (!el || !el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (!r.height) continue;
      last = k;
      if (r.bottom > line) break;
    }
    return last;
  }

  function setActive(k, scroll) {
    if (k < 0 || !state.items?.[k]) return;
    const block = ui.sents.querySelector(`.para[data-b="${k}"]`);
    if (state.active !== k) {
      state.active = k;
      ui.sents.querySelectorAll('.para.cur').forEach((b) => b.classList.remove('cur'));
      block?.classList.add('cur');
      highlightPage(state.items[k].el);
    }
    if (scroll && block) ui.body.scrollTo({ top: Math.max(0, block.offsetTop - 10), behavior: scroll });
  }

  function onPageScroll(e) {
    if (state?.mode !== 'article' || !state.items || !follow || !isOpen()) return;
    if (host && e.target instanceof Node && (e.target === host || host.contains(e.target))) return;
    if (Date.now() < followMuteUntil) return;
    clearTimeout(followTimer);
    followTimer = setTimeout(() => {
      if (state?.mode !== 'article' || !state.items || !isOpen()) return;
      const k = activeFromPage();
      if (k !== state.active) setActive(k, ui.sents.hidden ? false : 'smooth');
    }, 200);
  }

  function jumpToPage(k) {
    const el = state.items[k]?.el;
    followMuteUntil = Date.now() + 1500;
    if (el && el.isConnected) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setActive(k, false);
  }

  // 在网页里淡淡标出正在读的那一段（CSS Custom Highlight，不改页面 DOM）
  function highlightPage(el) {
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
    if (!el || !el.isConnected) {
      CSS.highlights.delete(HL);
      return;
    }
    if (!hlStyle || !hlStyle.isConnected) {
      hlStyle = document.createElement('style');
      hlStyle.textContent = `::highlight(${HL}) { background-color: rgba(99, 102, 241, .14); }`;
      (document.head || document.documentElement).appendChild(hlStyle);
    }
    const range = new Range();
    range.selectNodeContents(el);
    CSS.highlights.set(HL, new Highlight(range));
  }

  function onPortMessage(msg) {
    if (msg.type === 'error') {
      ui.sents.innerHTML = `<div class="error-box">${esc(msg.error)}</div>`;
      ui.meta.textContent = '';
      return;
    }
    if (msg.type === 'init') {
      state.sentences = msg.sentences;
      gistTab().hidden = msg.sentences.length < 2;
      if (msg.sentences.length > 1) ui.gist.innerHTML = '<div class="skel"></div><div class="skel w2"></div>';
      renderSentences();
      updateMeta();
      return;
    }
    if (msg.type === 'sentence') {
      state.results[msg.index] = { ...msg.data, source: msg.source };
      state.errors[msg.index] = '';
      state.status[msg.index] = 'done';
      renderSentence(msg.index);
      refreshAdded(msg.data.words.map((w) => w.word));
      updateMeta();
      updateWordsTab();
      if (state.mode === 'article') schedulePump();
      return;
    }
    if (msg.type === 'sentence-error') {
      state.errors[msg.index] = msg.error;
      state.status[msg.index] = 'error';
      renderSentence(msg.index);
      updateMeta();
      if (state.mode === 'article') schedulePump();
      return;
    }
    if (msg.type === 'usage') {
      state.foot = [msg.usageText, msg.costText].filter(Boolean).join(' · ');
      updateMeta();
      return;
    }
    if (msg.type === 'gist') {
      state.gist = msg.data;
      renderGist();
      return;
    }
    if (msg.type === 'gist-error') {
      state.gistError = msg.error;
      renderGist();
      return;
    }
    if (msg.type === 'done') {
      state.done = true;
      state.foot = [msg.usageText, msg.costText].filter(Boolean).join(' · ');
      updateMeta();
    }
  }

  function updateMeta() {
    const n = state.sentences.length;
    const ready = state.results.filter(Boolean).length;
    const parts = [`${n} 句`];
    if (state.mode === 'article') {
      parts[0] = `${state.paraItems.length} 段 ${n} 句`;
      parts.push(`已精读 ${ready}`);
      if (state.foot) parts.push(state.foot);
    } else if (!state.done) parts.push(`已出 ${ready}/${n}`);
    else if (state.foot) parts.push(state.foot);
    ui.meta.textContent = parts.join(' · ');
    ui.meta.title = ui.meta.textContent;
  }

  function legendHtml() {
    const colors = {
      subject: 'border-bottom:2px solid #2563eb',
      verb: 'border-bottom:2px solid #dc2626',
      object: 'border-bottom:2px solid #059669',
      clause: 'background:#f3ecff',
      nonfinite: 'background:#fff1d6',
      insert: 'background:#eef1f5'
    };
    return `<div class="legend">${Object.entries(ROLE_LABEL)
      .map(([r, label]) => `<span><i style="${colors[r]}"></i>${label}</span>`)
      .join('')}</div>`;
  }

  function renderSentences() {
    ui.sents.innerHTML = legendHtml() + state.sentences.map((_, i) => `<div class="sent" data-i="${i}"></div>`).join('');
    state.sentences.forEach((_, i) => renderSentence(i));
  }

  function tokensHtml(text) {
    return String(text)
      .split(/([A-Za-z][A-Za-z'’-]*)/)
      .map((part, i) => (i % 2 ? `<span class="tok" data-w="${esc(part)}">${esc(part)}</span>` : esc(part)))
      .join('');
  }

  function segmentsHtml(segments) {
    return segments
      .map((s) => {
        if (s.type === 'text') return tokensHtml(s.text);
        const title = ROLE_LABEL[s.role] + (s.note ? '：' + s.note : '');
        return `<span class="r r-${esc(s.role)}" title="${esc(title)}">${segmentsHtml(s.children || [])}</span>`;
      })
      .join('');
  }

  function wordRowHtml(w, sentenceIndex, showSource) {
    const k = key(w.word);
    const on = !!added[k];
    const ipa = cfg.showIpa !== false && w.ipa ? `<span class="ipa">${esc(w.ipa)}</span>` : '';
    const src = showSource ? `<div class="src-sent">${esc(state.sentences[sentenceIndex] || '')}</div>` : '';
    return `<div class="word">
      <div class="word-main">
        <span class="w">${esc(w.word)}</span>${ipa}<span class="pos">${esc(w.pos)}</span>
        <div>${esc(w.inContext)}${w.common ? `<span class="common">　常见：${esc(w.common)}</span>` : ''}</div>${src}
      </div>
      <button class="add${on ? ' on' : ''}" data-add="${esc(w.word)}" data-si="${sentenceIndex}">${on ? '✓ 已加入' : '＋生词'}</button>
    </div>`;
  }

  function renderSentence(i) {
    const box = ui.sents.querySelector(`.sent[data-i="${i}"]`);
    if (!box) return;
    const sentence = state.sentences[i];
    const r = state.results[i];
    const err = state.errors[i];
    const article = state.mode === 'article';
    const no = article ? i - state.items[state.sentPara[i]].from + 1 : i + 1;
    // 全文模式下还没轮到的句子只显示原文，不占位转圈
    const idle = article && !r && !err && state.status[i] !== 'pending';
    box.classList.toggle('idle', idle);
    const head = (extra = '') =>
      `<div class="sent-head"><span class="num">${no}</span><span class="diff">${extra}</span>` +
      `<button class="icon act-speak" data-speak="${i}" title="朗读这句">${ICONS.speak}</button></div>`;
    if (!r) {
      box.innerHTML =
        head() +
        `<div class="en plain">${tokensHtml(sentence)}</div>` +
        (err
          ? `<div class="sent-err"><span>${esc(err)}</span><button class="btn-link" data-retry="${i}">重试</button></div>`
          : idle
            ? ''
            : '<div class="skel"></div><div class="skel w2"></div>');
      return;
    }
    const diff = r.difficulty ? '难度 ' + '●'.repeat(r.difficulty) + '○'.repeat(5 - r.difficulty) : '';
    const cacheTag = r.source === 'cache' ? ' <span class="from-cache">· 缓存</span>' : '';
    const sections = [];
    if (r.howToRead) sections.push(`<div class="sec"><div class="sec-t">怎么读</div><div class="read">${esc(r.howToRead)}</div></div>`);
    if (r.phrases.length)
      sections.push(
        `<div class="sec"><div class="sec-t">搭配</div>${r.phrases
          .map((p) => `<span class="pill"><b>${esc(p.text)}</b>${esc(p.meaning)}</span>`)
          .join('')}</div>`
      );
    if (r.words.length)
      sections.push(`<div class="sec"><div class="sec-t">重点词</div>${r.words.map((w) => wordRowHtml(w, i, false)).join('')}</div>`);
    if (r.grammar.length)
      sections.push(`<div class="sec"><div class="sec-t">语法</div><ul class="gram">${r.grammar.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>`);
    box.innerHTML =
      head(diff + cacheTag) +
      `<div class="en">${segmentsHtml(r.segments || [{ type: 'text', text: sentence }])}</div>` +
      `<div class="zh">${esc(r.translation)}</div>` +
      sections.join('');
  }

  function allWords() {
    const seen = new Set();
    const out = [];
    state.results.forEach((r, i) => {
      (r?.words || []).forEach((w) => {
        const k = key(w.word);
        if (seen.has(k)) return;
        seen.add(k);
        out.push({ w, i });
      });
    });
    return out;
  }

  function updateWordsTab() {
    const n = allWords().length;
    ui.tabs.find((t) => t.dataset.tab === 'words').textContent = n ? `词汇 ${n}` : '词汇';
    if (!ui.words.hidden) renderWords();
  }

  function renderWords() {
    if (!state) return;
    const list = allWords();
    ui.words.innerHTML = list.length
      ? list.map(({ w, i }) => wordRowHtml(w, i, true)).join('')
      : `<div class="empty">${state.mode === 'article' ? '重点词会随阅读进度汇总到这里' : state.done ? '没有超出当前水平的重点词' : '分析中…'}</div>`;
  }

  function renderGist() {
    if (state.gistError) {
      ui.gist.innerHTML = `<div class="error-box">${esc(state.gistError)}</div>`;
      return;
    }
    const g = state.gist;
    if (!g) return;
    if (state.mode === 'article') {
      const brief = ui.sents.querySelector('.art-gist');
      if (brief && g.gist) {
        brief.textContent = g.gist;
        brief.hidden = false;
      }
      const rows = g.sections
        .map((sec) => {
          const range = sec.to > sec.from ? `第 ${sec.from}–${sec.to} 段` : `第 ${sec.from} 段`;
          return `<button class="sec-row" data-sec="${sec.from}" title="跳到这一部分"><span class="rng">${range}</span><b>${esc(sec.title || '（未命名）')}</b>${sec.summary ? `<div>${esc(sec.summary)}</div>` : ''}</button>`;
        })
        .join('');
      ui.gist.innerHTML =
        (g.gist ? `<div class="gist">${esc(g.gist)}</div>` : '') +
        (rows ? `<div class="sec-t" style="margin-top:14px">文章结构</div>${rows}` : '') +
        (g.points.length ? `<div class="sec-t" style="margin-top:14px">阅读提示</div><ul class="flow">${g.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '');
      return;
    }
    ui.gist.innerHTML =
      `<div class="gist">${esc(g.gist || '（没有返回主旨）')}</div>` +
      (g.flow.length ? `<div class="sec-t" style="margin-top:14px">句间逻辑</div><ul class="flow">${g.flow.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '');
  }

  async function refreshAdded(words) {
    if (!words.length) return;
    const res = await send({ type: 'HT_VOCAB_HAS', words });
    if (!res?.ok) return;
    let changed = false;
    for (const [w, on] of Object.entries(res.has)) {
      if (!!added[key(w)] !== on) {
        added[key(w)] = on;
        changed = true;
      }
    }
    if (changed) syncAddButtons();
  }

  function syncAddButtons() {
    root.querySelectorAll('[data-add]').forEach((b) => {
      const on = !!added[key(b.dataset.add)];
      b.classList.toggle('on', on);
      b.textContent = on ? '✓ 已加入' : '＋生词';
    });
  }

  function findWord(word, si) {
    const k = key(word);
    const fromResult = state.results[si]?.words.find((w) => key(w.word) === k);
    if (fromResult) return fromResult;
    if (popWord && key(popWord.word) === k) return popWord;
    return null;
  }

  async function toggleAdd(btn) {
    const word = btn.dataset.add;
    const si = Number(btn.dataset.si);
    const k = key(word);
    if (added[k]) {
      added[k] = false;
      syncAddButtons();
      const res = await send({ type: 'HT_VOCAB_REMOVE', word });
      if (!res?.ok) {
        added[k] = true;
        syncAddButtons();
      }
      return;
    }
    const w = findWord(word, si) || { word };
    added[k] = true;
    syncAddButtons();
    const res = await send({
      type: 'HT_VOCAB_ADD',
      entry: {
        word: w.word,
        ipa: w.ipa,
        pos: w.pos,
        meaning: w.inContext,
        common: w.common,
        sentence: state.sentences[si] || '',
        url: location.href,
        title: document.title
      }
    });
    if (!res?.ok) {
      added[k] = false;
      syncAddButtons();
    }
  }

  // ---- 点词释义 ----
  let popWord = null;
  let popReq = 0;

  function hidePop() {
    if (!ui) return;
    ui.pop.hidden = true;
    popWord = null;
    root.querySelectorAll('.tok.sel').forEach((t) => t.classList.remove('sel'));
  }

  function placePop(anchor) {
    const body = ui.body.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    ui.pop.hidden = false;
    const w = ui.pop.offsetWidth;
    let left = a.left - body.left + a.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, body.width - w - 8));
    const top = a.bottom - body.top + ui.body.scrollTop + 6;
    ui.pop.style.left = left + 'px';
    ui.pop.style.top = top + 'px';
  }

  async function openPop(tok) {
    const word = tok.dataset.w;
    const box = tok.closest('.sent');
    const si = Number(box?.dataset.i);
    const sentence = state.sentences[si] || tok.closest('[data-ctx]')?.dataset.ctx || word;
    root.querySelectorAll('.tok.sel').forEach((t) => t.classList.remove('sel'));
    tok.classList.add('sel');
    const id = ++popReq;
    popWord = null;
    ui.pop.innerHTML = `<div class="pop-row"><span class="w">${esc(word)}</span></div><div class="loading">查询中…</div>`;
    placePop(tok);
    const res = await send({ type: 'HT_WORD_LOOKUP', word, sentence });
    if (id !== popReq || ui.pop.hidden) return;
    if (!res?.ok) {
      ui.pop.innerHTML = `<div class="pop-row"><span class="w">${esc(word)}</span></div><div class="error-box" style="margin-top:6px">${esc(res?.error || '查询失败')}</div>`;
      return;
    }
    const d = res.data;
    popWord = d;
    const k = key(d.word);
    if (added[k] === undefined) refreshAdded([d.word]);
    const on = !!added[k];
    const ipa = cfg.showIpa !== false && d.ipa ? `<span class="ipa">${esc(d.ipa)}</span>` : '';
    ui.pop.innerHTML = `<div class="pop-row">
        <span class="w">${esc(d.word)}${ipa}<span class="pos">${esc(d.pos)}</span></span>
        <button class="icon" data-say="${esc(d.word)}" title="朗读">${ICONS.speak}</button>
        <button class="add${on ? ' on' : ''}" data-add="${esc(d.word)}" data-si="${si}">${on ? '✓ 已加入' : '＋生词'}</button>
      </div>
      <div class="mean">${esc(d.inContext)}</div>
      ${d.common ? `<div class="common">常见：${esc(d.common)}</div>` : ''}`;
    placePop(tok);
  }

  function onBodyClick(e) {
    const t = e.target;
    const add = t.closest('[data-add]');
    if (add) return toggleAdd(add);
    const retry = t.closest('[data-retry]');
    if (retry) {
      const i = Number(retry.dataset.retry);
      if (state.mode === 'article') return requestSentences([i]);
      state.errors[i] = '';
      renderSentence(i);
      connect().postMessage({ type: 'retry', text: state.text, index: i });
      return;
    }
    const jump = t.closest('[data-jump]');
    if (jump) return jumpToPage(Number(jump.dataset.jump));
    const sec = t.closest('[data-sec]');
    if (sec) {
      const k = state.paraItems?.[Number(sec.dataset.sec) - 1];
      if (k === undefined) return;
      switchTab('sents');
      jumpToPage(k);
      setActive(k, 'auto');
      return;
    }
    const chip = t.closest('[data-follow]');
    if (chip) {
      follow = !follow;
      chip.classList.toggle('on', follow);
      if (follow) setActive(activeFromPage(), 'smooth');
      return;
    }
    const sp = t.closest('[data-speak]');
    if (sp) return toggleSpeak(state.sentences[Number(sp.dataset.speak)], sp);
    const say = t.closest('[data-say]');
    if (say) return toggleSpeak(say.dataset.say, say);
    const tok = t.closest('.tok');
    if (tok) return openPop(tok);
    if (!t.closest('.pop')) hidePop();
  }

  // ---- 朗读 ----
  let speakingBtn = null;

  function pickVoice() {
    const synth = window.speechSynthesis;
    const voices = (synth?.getVoices?.() || []).filter((v) => v && v.name);
    if (!voices.length) return null;
    if (cfg.speakVoice) {
      const exact = voices.find((v) => v.name === cfg.speakVoice);
      if (exact) return exact;
    }
    const english = voices.filter((v) => /^en/i.test(v.lang || ''));
    if (english.length) return english.find((v) => v.localService) || english[0];
    return voices[0];
  }

  function stopSpeak() {
    try {
      window.speechSynthesis?.cancel();
    } catch (_) {}
    if (speakingBtn) speakingBtn.classList.remove('on');
    speakingBtn = null;
  }

  function toggleSpeak(text, btn) {
    const synth = window.speechSynthesis;
    if (!synth || !text) return;
    const same = speakingBtn === btn;
    stopSpeak();
    if (same) return;
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang || 'en-US';
    } else u.lang = 'en-US';
    const rate = Number(cfg.speakRate);
    u.rate = Number.isFinite(rate) && rate > 0 ? Math.min(2, Math.max(0.5, rate)) : 1;
    u.onend = u.onerror = () => {
      if (speakingBtn === btn) stopSpeak();
    };
    speakingBtn = btn;
    btn.classList.add('on');
    synth.speak(u);
  }

  // ---- 入口 ----
  function open(text) {
    const src = String(text || '').trim();
    if (!src) return;
    if (IS_TOP) show(src);
    else send({ type: 'HT_DEEP_OPEN', text: src });
  }

  function selectedText() {
    const sel = window.getSelection();
    return sel && !sel.isCollapsed ? sel.toString().trim() : '';
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'HT_DEEP_SHOW' && IS_TOP) show(msg.text);
    else if (msg?.type === 'HT_ARTICLE_START' && IS_TOP) showArticle();
    else if (msg?.type === 'HT_DEEP_SELECTION') {
      const text = selectedText() || msg.fallback || '';
      if (text) open(text);
      else if (IS_TOP && !msg.fallback) {
        if (isOpen()) close();
        else {
          // 没有选区就精读全文；稍等一下，选区若在 iframe 里，那边会转发过来并取消这次全文精读
          clearTimeout(articleTimer);
          articleTimer = setTimeout(showArticle, 180);
        }
      }
    }
  });

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !isOpen()) return;
      if (!ui.pop.hidden) hidePop();
      else close();
    },
    true
  );

  window.__htDeep = {
    open,
    article: showArticle,
    close,
    isOpen,
    owns: (node) => !!host && (node === host || host.contains(node))
  };
})();
