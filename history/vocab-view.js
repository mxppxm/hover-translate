import {
  readVocab,
  listVocab,
  dueQueue,
  removeWord,
  reviewWord,
  clearVocab,
  isDue,
  isMastered,
  markWord,
  toCsv,
  toAnkiTsv,
  DAY
} from '../shared/vocab.js';
import { getConfig } from '../shared/config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDay = (ts) => (ts ? new Date(ts).toLocaleDateString('zh-CN') : '—');
const fmtTime = (ts) => (ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '—');

function sentenceHtml(sentence, word) {
  return markWord(sentence, word)
    .map((p) => (p.hit ? `<mark>${esc(p.text)}</mark>` : esc(p.text)))
    .join('');
}

function dueText(e, now) {
  if (isDue(e, now)) return '<span class="tag due">待复习</span>';
  if (isMastered(e)) return `<span class="tag ok">已掌握</span><div class="sub">${fmtDay(e.review.due)}</div>`;
  const days = Math.max(1, Math.round((e.review.due - now) / DAY));
  return `<span class="tag">${days} 天后</span><div class="sub">已复习 ${e.review.reps || 0} 次</div>`;
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function initVocab() {
  const cfg = await getConfig();
  const st = { vocab: {}, keyword: '', filter: 'all', queue: [], idx: 0, flipped: false, done: { again: 0, hard: 0, good: 0 } };

  async function reload() {
    st.vocab = await readVocab();
    const now = Date.now();
    const list = listVocab(st.vocab);
    const due = list.filter((e) => isDue(e, now)).length;
    $('vocabCount').textContent = list.length || '';
    $('dueCount').textContent = due || '';
    $('vocabSummary').innerHTML = [
      `生词 <b>${list.length}</b> 个`,
      `待复习 <b>${due}</b>`,
      `已掌握 <b>${list.filter(isMastered).length}</b>`
    ]
      .map((t) => `<span>${t}</span>`)
      .join('');
    renderList();
  }

  function visible() {
    const now = Date.now();
    const kw = st.keyword.trim().toLowerCase();
    return listVocab(st.vocab).filter((e) => {
      if (st.filter === 'due' && !isDue(e, now)) return false;
      if (st.filter === 'mastered' && !isMastered(e)) return false;
      if (st.filter === 'learning' && isMastered(e)) return false;
      if (!kw) return true;
      return [e.word, e.meaning, e.common, e.sentence].some((v) => String(v || '').toLowerCase().includes(kw));
    });
  }

  function renderList() {
    const rows = visible();
    const now = Date.now();
    $('vocabEmpty').hidden = rows.length > 0;
    $('vocabRows').innerHTML = rows
      .map(
        (e) => `<tr>
        <td class="word-col"><b class="vw">${esc(e.word)}</b>${cfg.showIpa !== false && e.ipa ? `<div class="sub">${esc(e.ipa)}</div>` : ''}</td>
        <td class="mean-col">${e.pos ? `<span class="pos">${esc(e.pos)}</span> ` : ''}${esc(e.meaning)}${e.common ? `<div class="sub">常见：${esc(e.common)}</div>` : ''}</td>
        <td class="sent-col">${e.sentence ? sentenceHtml(e.sentence, e.word) : '<span class="sub">—</span>'}${
          e.url ? `<div class="sub"><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title || e.url)}</a></div>` : ''
        }</td>
        <td class="review-col">${dueText(e, now)}</td>
        <td class="time-col">${fmtTime(e.ts)}</td>
        <td class="op-col"><button data-del="${esc(e.word)}">删除</button></td>
      </tr>`
      )
      .join('');
  }

  $('vocabRows').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-del]');
    if (!btn) return;
    await removeWord(btn.dataset.del);
    await reload();
  });
  $('vocabSearch').addEventListener('input', (ev) => {
    st.keyword = ev.target.value;
    renderList();
  });
  $('vocabFilter').addEventListener('change', (ev) => {
    st.filter = ev.target.value;
    renderList();
  });
  $('exportCsv').addEventListener('click', () => {
    download(`生词本-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(visible()), 'text/csv;charset=utf-8');
  });
  $('exportAnki').addEventListener('click', () => {
    download(`生词本-anki-${new Date().toISOString().slice(0, 10)}.txt`, toAnkiTsv(visible()), 'text/plain;charset=utf-8');
  });
  $('clearVocab').addEventListener('click', async () => {
    if (!confirm('清空生词本？复习进度也会一起删除。')) return;
    await clearVocab();
    await reload();
  });

  // ---- 复习 ----
  const box = $('review');

  function startSession() {
    st.queue = dueQueue(st.vocab);
    st.idx = 0;
    st.flipped = false;
    st.done = { again: 0, hard: 0, good: 0 };
    renderReview();
  }

  function speak(text) {
    if (typeof speechSynthesis === 'undefined' || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    const v = voices.find((x) => x.name === cfg.speakVoice) || voices.find((x) => /^en/i.test(x.lang));
    if (v) u.voice = v;
    u.lang = v?.lang || 'en-US';
    u.rate = Number(cfg.speakRate) || 1;
    speechSynthesis.speak(u);
  }

  function renderReview() {
    const list = listVocab(st.vocab);
    if (!list.length) {
      box.innerHTML = '<div class="rv-empty">生词本还是空的。</div>';
      return;
    }
    const e = st.queue[st.idx];
    if (!e) {
      const reviewed = st.done.again + st.done.hard + st.done.good;
      const next = list.map((x) => x.review?.due || 0).filter((t) => t > Date.now()).sort((a, b) => a - b)[0];
      box.innerHTML = `<div class="rv-empty">
          <div class="rv-big">${reviewed ? '这轮复习完了' : '现在没有要复习的词'}</div>
          ${reviewed ? `<p>认识 ${st.done.good} · 模糊 ${st.done.hard} · 不认识 ${st.done.again}</p>` : ''}
          ${next ? `<p class="sub">下一个到期：${fmtTime(next)}</p>` : ''}
        </div>`;
      return;
    }
    const left = st.queue.length - st.idx;
    box.innerHTML = `
      <div class="rv-progress">剩余 ${left} 个</div>
      <div class="rv-card">
        <div class="rv-word">${esc(e.word)} <button class="rv-say" title="朗读">🔊</button></div>
        ${e.sentence ? `<div class="rv-sent">${sentenceHtml(e.sentence, e.word)}</div>` : ''}
        <div class="rv-back" ${st.flipped ? '' : 'hidden'}>
          <div class="rv-ipa">${cfg.showIpa !== false && e.ipa ? esc(e.ipa) + ' ' : ''}<span class="pos">${esc(e.pos)}</span></div>
          <div class="rv-mean">${esc(e.meaning)}</div>
          ${e.common ? `<div class="sub">常见：${esc(e.common)}</div>` : ''}
        </div>
      </div>
      <div class="rv-actions">
        ${
          st.flipped
            ? `<button data-rate="again" class="again">不认识 <kbd>1</kbd></button>
               <button data-rate="hard" class="hard">模糊 <kbd>2</kbd></button>
               <button data-rate="good" class="good">认识 <kbd>3</kbd></button>`
            : '<button data-flip class="primary">显示释义 <kbd>空格</kbd></button>'
        }
      </div>`;
  }

  async function rate(r) {
    const e = st.queue[st.idx];
    if (!e || !st.flipped) return;
    await reviewWord(e.key, r);
    st.done[r] += 1;
    // 不认识的词在本轮末尾再出现一次
    if (r === 'again') st.queue.push(e);
    st.idx += 1;
    st.flipped = false;
    st.vocab = await readVocab();
    const due = listVocab(st.vocab).filter((x) => isDue(x)).length;
    $('dueCount').textContent = due || '';
    renderReview();
  }

  box.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-flip]')) {
      st.flipped = true;
      renderReview();
    } else if (ev.target.closest('[data-rate]')) rate(ev.target.closest('[data-rate]').dataset.rate);
    else if (ev.target.closest('.rv-say')) speak(st.queue[st.idx]?.word);
  });

  document.addEventListener('keydown', (ev) => {
    if (location.hash !== '#review' || ev.target.closest('input, select, textarea')) return;
    if (!st.flipped && (ev.key === ' ' || ev.key === 'Enter')) {
      ev.preventDefault();
      if (st.queue[st.idx]) {
        st.flipped = true;
        renderReview();
      }
    } else if (st.flipped && ['1', '2', '3'].includes(ev.key)) {
      rate({ 1: 'again', 2: 'hard', 3: 'good' }[ev.key]);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.vocab && location.hash !== '#review') reload();
  });

  await reload();
  let current = '';
  return {
    enter(view) {
      if (view === 'review' && current !== 'review') startSession();
      if (view === 'vocab') reload();
      current = view;
    }
  };
}
