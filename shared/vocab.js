import { normKey } from './cache.js';
import { withLock } from './lock.js';

// 生词本：storage 键 vocab，{ [归一化词]: entry }
export const DAY = 24 * 60 * 60 * 1000;
export const AGAIN_DELAY = 10 * 60 * 1000;
export const MAX_INTERVAL = 180;
export const MASTERED_INTERVAL = 21;
export const RATINGS = ['again', 'hard', 'good'];

// 简化版间隔重复：不认识 → 10 分钟后再来；模糊 → 间隔 ×1.2（至少 1 天）；认识 → 1、3 天，之后 ×2.5
export function schedule(review, rating, now = Date.now()) {
  const prev = { interval: 0, reps: 0, lapses: 0, ...(review || {}) };
  if (rating === 'again') {
    return { interval: 0, reps: 0, lapses: prev.lapses + 1, due: now + AGAIN_DELAY, last: now };
  }
  let interval;
  if (rating === 'hard') interval = Math.max(1, Math.round(prev.interval * 1.2));
  else if (rating === 'good') interval = prev.interval < 1 ? 1 : prev.interval < 3 ? 3 : Math.round(prev.interval * 2.5);
  else throw new Error('未知评分：' + rating);
  interval = Math.min(MAX_INTERVAL, interval);
  return { interval, reps: prev.reps + 1, lapses: prev.lapses, due: now + interval * DAY, last: now };
}

export function isDue(entry, now = Date.now()) {
  return (entry?.review?.due ?? 0) <= now;
}

export function isMastered(entry) {
  return (entry?.review?.interval || 0) >= MASTERED_INTERVAL;
}

export function wordPattern(word) {
  const w = String(word || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  if (!w) return null;
  // 粗略覆盖常见屈折：s/es/ed/d/ing，以及去 e 加 ing（reason → reasoning, make → making）
  const stem = w.endsWith('e') ? `(?:${w}|${w.slice(0, -1)})` : w;
  return new RegExp(`\\b${stem}(?:s|es|ed|d|ing)?\\b`, 'i');
}

export function markWord(sentence, word) {
  const s = String(sentence || '');
  const re = wordPattern(word);
  const m = re ? s.match(re) : null;
  if (!m) return [{ text: s, hit: false }];
  return [
    { text: s.slice(0, m.index), hit: false },
    { text: m[0], hit: true },
    { text: s.slice(m.index + m[0].length), hit: false }
  ].filter((p) => p.text);
}

export function makeEntry(input, now = Date.now()) {
  const word = String(input?.word || '').replace(/\s+/g, ' ').trim();
  if (!word) return null;
  const clip = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  return {
    word,
    ipa: clip(input.ipa, 60),
    pos: clip(input.pos, 20),
    meaning: clip(input.meaning || input.inContext, 200),
    common: clip(input.common, 200),
    sentence: clip(input.sentence, 600),
    url: clip(input.url, 500),
    title: clip(input.title, 200),
    ts: now,
    review: { interval: 0, reps: 0, lapses: 0, due: now, last: 0 }
  };
}

export async function readVocab() {
  const { vocab = {} } = await chrome.storage.local.get('vocab');
  return vocab;
}

export function addWord(input) {
  return withLock(async () => {
    const entry = makeEntry(input);
    if (!entry) return null;
    const vocab = await readVocab();
    const key = normKey(entry.word);
    const old = vocab[key];
    // 已存在：补全缺的字段，保留原来的复习进度与加入时间
    vocab[key] = old
      ? {
          ...old,
          ipa: old.ipa || entry.ipa,
          pos: old.pos || entry.pos,
          meaning: old.meaning || entry.meaning,
          common: old.common || entry.common,
          sentence: old.sentence || entry.sentence,
          url: old.url || entry.url,
          title: old.title || entry.title
        }
      : entry;
    await chrome.storage.local.set({ vocab });
    return { key, entry: vocab[key] };
  });
}

export function removeWord(word) {
  return withLock(async () => {
    const vocab = await readVocab();
    delete vocab[normKey(word)];
    await chrome.storage.local.set({ vocab });
  });
}

export function reviewWord(key, rating, now = Date.now()) {
  return withLock(async () => {
    const vocab = await readVocab();
    const entry = vocab[key];
    if (!entry) return null;
    entry.review = schedule(entry.review, rating, now);
    await chrome.storage.local.set({ vocab });
    return entry;
  });
}

export function clearVocab() {
  return withLock(() => chrome.storage.local.set({ vocab: {} }));
}

export function listVocab(vocab) {
  return Object.entries(vocab || {})
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.ts - a.ts);
}

export function dueQueue(vocab, now = Date.now()) {
  return listVocab(vocab)
    .filter((e) => isDue(e, now))
    .sort((a, b) => (a.review?.due || 0) - (b.review?.due || 0));
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(entries) {
  const head = ['单词', '音标', '词性', '语境义', '常见义', '原句', '来源', '加入时间', '下次复习'];
  const day = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : '');
  const rows = entries.map((e) => [e.word, e.ipa, e.pos, e.meaning, e.common, e.sentence, e.url, day(e.ts), day(e.review?.due)]);
  return '\uFEFF' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

const html = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Anki「导入文本」：制表符分隔，两列（正面：单词 + 语境原句 / 背面：音标词性 + 释义），允许 HTML
export function toAnkiTsv(entries) {
  return entries
    .map((e) => {
      const sentence = markWord(e.sentence, e.word)
        .map((p) => (p.hit ? `<b>${html(p.text)}</b>` : html(p.text)))
        .join('');
      const front = `<b>${html(e.word)}</b>` + (e.sentence ? `<br><i>${sentence}</i>` : '');
      const back = [
        [html(e.ipa), html(e.pos)].filter(Boolean).join(' '),
        html(e.meaning),
        e.common ? `<small>常见：${html(e.common)}</small>` : ''
      ]
        .filter(Boolean)
        .join('<br>');
      return [front, back].map((c) => c.replace(/[\t\n]/g, ' ')).join('\t');
    })
    .join('\n');
}
