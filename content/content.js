(() => {
  const HOST_ID = '__hover_translate_root__';
  const TOOLBAR_HOST_ID = '__hover_translate_toolbar__';
  const MIN_LEN = 1;
  const MAX_LEN = 4000;
  const SPEAK_MAX_CHARS = 300;

  const svg = (body, fill = 'none') =>
    `<svg viewBox="0 0 24 24" width="16" height="16" fill="${fill}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICONS = {
    speak: svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
    stop: svg('<rect x="7" y="7" width="10" height="10" rx="1.5"/>'),
    star: svg('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
    starOn: svg('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>', 'currentColor'),
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    deep: svg('<path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H9a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5h-5A1.5 1.5 0 0 1 3 16z"/><path d="M21 5.5A1.5 1.5 0 0 0 19.5 4H15a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5h5a1.5 1.5 0 0 0 1.5-1.5z"/>'),
    vocab: svg('<path d="M6 3.5h12v17l-6-4-6 4z"/><path d="M12 7.5v6M9 10.5h6"/>'),
    vocabOn: svg('<path d="M6 3.5h12v17l-6-4-6 4z"/><path d="m9 10.5 2 2 4-4"/>')
  };

  const wordCount = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
  const isVocabCandidate = (t) => /^[A-Za-z][A-Za-z'’ -]*$/.test(t) && t.length <= 40 && wordCount(t) <= 4;
  const isDeepCandidate = (t) => /[A-Za-z]/.test(t) && wordCount(t) >= 3;

  let host = null;
  let shadow = null;
  let els = null;
  let toolbarHost = null;
  let toolbar = null;
  let current = { text: '', rect: null };
  let reqId = 0;
  let speaking = false;
  let cfg = { autoTranslate: true, autoSpeak: false, speakRate: 1, speakVoice: '' };

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
    .card {
      width: 348px; max-width: calc(100vw - 24px);
      background: #fff; color: #111827;
      border: 1px solid rgba(17,24,39,.10); border-radius: 12px;
      box-shadow: 0 12px 32px rgba(15,23,42,.18);
      font: 13px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
      overflow: hidden;
    }
    .head {
      display: flex; align-items: flex-start; gap: 8px;
      margin: 0 8px 0 12px; padding: 8px 0 6px; border-bottom: 1px dashed #e5e7eb;
    }
    .actions { display: flex; align-items: center; gap: 2px; flex: none; }
    .icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border: 0; background: transparent; color: #6b7280;
      cursor: pointer; border-radius: 6px;
    }
    .icon svg { display: block; }
    .icon:hover { background: #f3f4f6; color: #111827; }
    .icon.on { color: #d97706; }
    .icon.speak.on { color: #2563eb; }
    .icon.act-vocab.on { color: #059669; }
    .body { padding: 8px 12px 10px; max-height: 320px; overflow-y: auto; }
    .src-text {
      flex: 1; min-width: 0; padding-top: 3px;
      font-size: 12px; color: #6b7280; word-break: break-word;
      max-height: 60px; overflow: hidden;
    }
    .out { white-space: pre-wrap; word-break: break-word; }
    .out.error { color: #b91c1c; }
    .loading { display: flex; align-items: center; gap: 8px; color: #6b7280; }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: #6366f1; animation: ht-bounce .9s infinite ease-in-out; }
    .dot:nth-child(2) { animation-delay: .15s; }
    .dot:nth-child(3) { animation-delay: .3s; }
    @keyframes ht-bounce { 0%,80%,100% { transform: translateY(0); opacity: .4 } 40% { transform: translateY(-4px); opacity: 1 } }
    .example {
      margin-top: 8px; padding: 6px 10px; border-radius: 8px;
      background: #f9fafb; border-left: 3px solid #c7d2fe;
    }
    .example .en { color: #374151; }
    .example .zh { color: #6b7280; font-size: 12px; margin-top: 2px; }
    @media (prefers-color-scheme: dark) {
      .card { background: #1f2937; color: #f9fafb; border-color: rgba(255,255,255,.10); }
      .head { border-bottom-color: #374151; }
      .src-text { color: #9ca3af; }
      .out.error { color: #fca5a5; }
      .icon { color: #9ca3af; }
      .icon:hover { background: #374151; color: #f9fafb; }
      .example { background: #111827; border-left-color: #4338ca; }
      .example .en { color: #e5e7eb; }
      .example .zh { color: #9ca3af; }
    }
  `;

  const TOOLBAR_CSS = `
    :host { all: initial; }
    .btn {
      display: flex; align-items: center; gap: 5px;
      padding: 6px 10px; border-radius: 999px; cursor: pointer;
      background: #4f46e5; color: #fff; border: 0;
      box-shadow: 0 6px 18px rgba(79,70,229,.35);
      font: 12px/1 -apple-system, "PingFang SC", system-ui, sans-serif;
    }
    .btn:hover { background: #4338ca; }
  `;

  function ensureUi() {
    if (host) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;left:0;top:0;display:none;';
    wrapper.innerHTML = `
      <div class="card" role="dialog" aria-label="划词翻译结果">
        <div class="head">
          <div class="src-text"></div>
          <div class="actions">
            <button class="icon act-deep" title="精读（逐句拆解结构、重点词）">${ICONS.deep}</button>
            <button class="icon act-vocab" title="加入生词本">${ICONS.vocab}</button>
            <button class="icon act-star" title="收藏">${ICONS.star}</button>
            <button class="icon speak act-speak" title="朗读原文">${ICONS.speak}</button>
            <button class="icon act-copy" title="复制译文">${ICONS.copy}</button>
          </div>
        </div>
        <div class="body">
          <div class="out"></div>
          <div class="example" hidden><div class="en"></div><div class="zh"></div></div>
        </div>
      </div>`;
    shadow.append(style, wrapper);
    (document.body || document.documentElement).appendChild(host);

    els = {
      wrapper,
      srcText: wrapper.querySelector('.src-text'),
      out: wrapper.querySelector('.out'),
      example: wrapper.querySelector('.example'),
      exampleEn: wrapper.querySelector('.example .en'),
      exampleZh: wrapper.querySelector('.example .zh'),
      star: wrapper.querySelector('.act-star'),
      speak: wrapper.querySelector('.act-speak'),
      deep: wrapper.querySelector('.act-deep'),
      vocab: wrapper.querySelector('.act-vocab')
    };
    els.deep.addEventListener('click', () => {
      const text = current.text;
      hide();
      if (text && window.__htDeep) window.__htDeep.open(text);
    });
    els.vocab.addEventListener('click', toggleVocab);

    wrapper.querySelector('.act-copy').addEventListener('click', async () => {
      const text = els.out.textContent;
      if (!text) return;
      await copyText(text);
      const btn = wrapper.querySelector('.act-copy');
      btn.innerHTML = ICONS.check;
      setTimeout(() => {
        btn.innerHTML = ICONS.copy;
      }, 1200);
    });
    els.star.addEventListener('click', toggleStar);
    els.speak.addEventListener('click', toggleSpeak);
  }

  function ensureToolbar() {
    if (toolbarHost) return;
    toolbarHost = document.createElement('div');
    toolbarHost.id = TOOLBAR_HOST_ID;
    toolbarHost.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;';
    const sh = toolbarHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = TOOLBAR_CSS;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;left:0;top:0;display:none;';
    wrap.innerHTML = '<button class="btn" type="button">译</button>';
    sh.append(style, wrap);
    (document.body || document.documentElement).appendChild(toolbarHost);
    toolbar = { wrap, btn: wrap.querySelector('.btn') };
    toolbar.btn.addEventListener('mousedown', (e) => e.preventDefault());
    toolbar.btn.addEventListener('click', () => {
      hideToolbar();
      current.text ? runTranslate(current.text) : requestTranslate('');
    });
  }

  function hideToolbar() {
    if (toolbar) toolbar.wrap.style.display = 'none';
  }

  function place(el, rect) {
    el.style.display = 'block';
    const box = el.getBoundingClientRect();
    const margin = 8;
    let left = rect.left + rect.width / 2 - box.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));
    let top = rect.bottom + 6;
    if (top + box.height > window.innerHeight - margin) {
      const above = rect.top - box.height - 6;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - box.height - margin);
    }
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  }

  function showToolbar(rect) {
    ensureToolbar();
    toolbar.wrap.style.display = 'block';
    const box = toolbar.wrap.getBoundingClientRect();
    const left = Math.min(Math.max(4, rect.right + 6), window.innerWidth - box.width - 4);
    const top = Math.min(Math.max(4, rect.bottom + 6), window.innerHeight - box.height - 4);
    toolbar.wrap.style.left = Math.round(left) + 'px';
    toolbar.wrap.style.top = Math.round(top) + 'px';
  }

  function setSource(kind) {
    els.wrapper.dataset.source = kind;
  }

  function showLoading(text, rect) {
    ensureUi();
    reqId += 1;
    current = { text, rect, context: current.text === text ? current.context : '' };
    stopSpeaking();
    els.out.className = 'out';
    els.out.innerHTML =
      '<div class="loading"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
    els.srcText.textContent = text;
    setExample(null);
    setSource('loading');
    els.star.style.display = 'none';
    els.vocab.style.display = 'none';
    els.deep.style.display = isDeepCandidate(text) ? '' : 'none';
    place(els.wrapper, rect);
  }

  function showResult(text, rect, res) {
    ensureUi();
    current = { text, rect, context: current.text === text ? current.context : '' };
    els.srcText.textContent = text;
    if (!res || !res.ok) {
      setSource('error');
      els.out.className = 'out error';
      els.out.textContent = res?.error || '翻译失败';
      setExample(null);
      els.star.style.display = 'none';
      els.vocab.style.display = 'none';
      els.deep.style.display = isDeepCandidate(text) ? '' : 'none';
      place(els.wrapper, rect);
      return;
    }
    const fromCache = res.source === 'cache';
    setSource(fromCache ? 'cache' : 'model');
    els.out.className = 'out';
    els.out.textContent = res.translation;
    setExample(res.example);
    els.star.style.display = '';
    els.star.classList.remove('on');
    els.star.innerHTML = ICONS.star;
    els.deep.style.display = isDeepCandidate(text) ? '' : 'none';
    current.translation = res.translation;
    current.example = res.example || null;
    setVocabState(false);
    els.vocab.style.display = isVocabCandidate(text) ? '' : 'none';
    if (isVocabCandidate(text)) {
      const asked = text;
      request({ type: 'HT_VOCAB_HAS', words: [text] }).then((r) => {
        if (r?.ok && current.text === asked) setVocabState(!!r.has[text]);
      });
    }
    place(els.wrapper, rect);
    if (cfg.autoSpeak) speak();
  }

  function setExample(example) {
    const on = !!(example && example.en);
    els.example.hidden = !on;
    els.exampleEn.textContent = on ? example.en : '';
    els.exampleZh.textContent = on ? example.zh || '' : '';
  }

  function hide() {
    stopSpeaking();
    if (els) els.wrapper.style.display = 'none';
  }

  function clampSpeakText(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    return t.length <= SPEAK_MAX_CHARS ? t : t.slice(0, SPEAK_MAX_CHARS) + '…';
  }

  function pickVoice() {
    const synth = window.speechSynthesis;
    if (!synth || typeof synth.getVoices !== 'function') return null;
    const voices = (synth.getVoices() || []).filter((v) => v && v.name);
    if (!voices.length) return null;
    if (cfg.speakVoice) {
      const exact = voices.find((v) => v.name === cfg.speakVoice);
      if (exact) return exact;
    }
    const english = voices.filter((v) => /^en/i.test(v.lang || ''));
    if (english.length) return english.find((v) => v.localService) || english[0];
    return voices.find((v) => v.localService) || voices[0];
  }

  function setSpeaking(on) {
    speaking = on;
    if (!els) return;
    els.speak.classList.toggle('on', on);
    els.speak.innerHTML = on ? ICONS.stop : ICONS.speak;
    els.speak.title = on ? '停止朗读' : '朗读原文';
  }

  function stopSpeaking() {
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (_) {}
    if (speaking) setSpeaking(false);
  }

  function speak() {
    const synth = window.speechSynthesis;
    const text = clampSpeakText(current.text);
    if (!synth || typeof synth.speak !== 'function' || !text) return false;
    stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || 'en-US';
    } else {
      utterance.lang = 'en-US';
    }
    const rate = Number(cfg.speakRate);
    utterance.rate = Number.isFinite(rate) && rate > 0 ? Math.min(2, Math.max(0.5, rate)) : 1;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    try {
      synth.speak(utterance);
      setSpeaking(true);
      return true;
    } catch (_) {
      setSpeaking(false);
      return false;
    }
  }

  function toggleSpeak() {
    if (speaking) stopSpeaking();
    else speak();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-1000px;';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        return true;
      } catch (_) {
        return false;
      }
    }
  }

  async function toggleStar() {
    if (!current.text) return;
    const on = els.star.classList.toggle('on');
    els.star.innerHTML = on ? ICONS.starOn : ICONS.star;
    const existing = await request({ type: 'HT_STAR', text: current.text, star: on });
    if (!existing || !existing.ok) {
      els.star.classList.toggle('on', !on);
      els.star.innerHTML = on ? ICONS.star : ICONS.starOn;
    }
  }

  function setVocabState(on) {
    els.vocab.classList.toggle('on', on);
    els.vocab.innerHTML = on ? ICONS.vocabOn : ICONS.vocab;
    els.vocab.title = on ? '已在生词本（点击移出）' : '加入生词本';
  }

  async function toggleVocab() {
    const word = current.text;
    if (!word) return;
    const on = !els.vocab.classList.contains('on');
    setVocabState(on);
    const res = on
      ? await request({
          type: 'HT_VOCAB_ADD',
          entry: {
            word,
            meaning: String(current.translation || '').split('\n')[0].trim(),
            sentence: current.context || current.example?.en || '',
            url: location.href,
            title: document.title
          }
        })
      : await request({ type: 'HT_VOCAB_REMOVE', word });
    if (!res || !res.ok) setVocabState(!on);
  }

  // 取选区所在段落里包含该词的那一句，作为生词本里的语境原句
  function contextSentence(range, text) {
    try {
      let node = range.commonAncestorContainer;
      let el = node.nodeType === 1 ? node : node.parentElement;
      el = el?.closest('p, li, td, th, dd, dt, blockquote, figcaption, h1, h2, h3, h4, h5, h6, article, section, div') || el;
      const block = String(el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
      if (!block) return '';
      const needle = text.toLowerCase();
      const parts = Intl.Segmenter
        ? [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(block)].map((x) => x.segment.trim())
        : block.split(/(?<=[.!?])\s+/);
      const hit = parts.find((p) => p.toLowerCase().includes(needle));
      return hit && hit.length <= 600 && hit.toLowerCase() !== needle ? hit : '';
    } catch (_) {
      return '';
    }
  }

  function request(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (res) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(res);
        });
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    });
  }

  async function runTranslate(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_LEN) {
      ensureUi();
      const rect = current.rect || { left: 40, top: 40, bottom: 60, right: 60, width: 20, height: 20 };
      showResult(trimmed.slice(0, 60) + '…', rect, {
        ok: false,
        error: `选中内容过长（${trimmed.length} 字符，上限 ${MAX_LEN}）`
      });
      return;
    }
    const rect = current.rect || { left: 40, top: 40, bottom: 60, right: 60, width: 20, height: 20 };
    showLoading(trimmed, rect);
    const id = reqId;
    const res = await request({ type: 'HT_TRANSLATE', text: trimmed });
    if (id !== reqId) return;
    showResult(trimmed, rect, res);
  }

  function requestTranslate(fallbackText) {
    const info = selectionInfo();
    const text = (fallbackText || current.text || info?.text || window.getSelection()?.toString() || '').trim();
    if (!text) return;
    if (info?.rect) current = { text, rect: info.rect, context: info.context };
    else if (!current.rect) current = { text, rect: null };
    else current = { text, rect: current.rect };
    runTranslate(text);
  }

  function selectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    if (downInUi && window.__htDeep?.isOpen()) return null;
    const node = sel.anchorNode;
    if (window.__htDeep?.owns(node)) return null;
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    if (el && el.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return null;
    const text = sel.toString().trim();
    if (!text || text.length < MIN_LEN) return null;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return null;
    return { text, rect, context: isVocabCandidate(text) ? contextSentence(range, text) : '' };
  }

  let lastSignature = '';
  let downInUi = false;
  let timer = null;

  function onSelectionChange() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const info = selectionInfo();
      if (!info) {
        hideToolbar();
        if (els && els.wrapper.style.display !== 'none') hide();
        lastSignature = '';
        current = { text: '', rect: null };
        return;
      }
      const signature = info.text + '|' + Math.round(info.rect.left) + ',' + Math.round(info.rect.top);
      if (signature === lastSignature) return;
      lastSignature = signature;
      current = { text: info.text, rect: info.rect, context: info.context };
      if (cfg.autoTranslate === false) {
        showToolbar(info.rect);
        return;
      }
      runTranslate(info.text);
    }, 180);
  }

  document.addEventListener('selectionchange', onSelectionChange, true);
  document.addEventListener('mouseup', onSelectionChange, true);

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') {
        hide();
        hideToolbar();
      }
    },
    true
  );

  document.addEventListener(
    'mousedown',
    (e) => {
      const path = e.composedPath();
      downInUi = path.some((n) => n && n.nodeType === 1 && window.__htDeep?.owns(n));
      const inside = path.includes(host) || path.includes(toolbarHost);
      if (inside) return;
      hideToolbar();
      hide();
    },
    true
  );

  window.addEventListener(
    'scroll',
    () => {
      hide();
      hideToolbar();
    },
    { passive: true, capture: true }
  );

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'HT_TRANSLATE_NOW') requestTranslate(msg.text);
  });
})();