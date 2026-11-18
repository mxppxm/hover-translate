import { withLock } from './lock.js';
import { textDigest } from './deep.js';

// 精读记录：读过哪篇文章（或哪一段）、读到哪。存的是原文和分句，不存逐句分析结果——
// 那些在精读缓存里，重新打开时按句命中。storage 键 readings。
export const READINGS_MAX = 30;

export function readingId(doc) {
  if (doc?.mode === 'article') return 'a-' + textDigest(doc.url || doc.title || '');
  return 's-' + textDigest(String(doc?.text || '').replace(/\s+/g, ' ').trim().toLowerCase());
}

export async function readReadings() {
  const { readings = {} } = await chrome.storage.local.get('readings');
  return readings;
}

export function pruneReadings(readings, max = READINGS_MAX) {
  Object.keys(readings)
    .sort((a, b) => (readings[b].lastOpen || 0) - (readings[a].lastOpen || 0))
    .slice(max)
    .forEach((k) => delete readings[k]);
  return readings;
}

// 同一篇文章（同一网址）只留一条：内容更新为最新的，首次阅读时间和进度保留
export function saveReading(doc, now = Date.now()) {
  if (!doc || typeof doc !== 'object') return Promise.resolve(null);
  if (doc.mode === 'article' ? !Array.isArray(doc.sentences) || !doc.sentences.length : !doc.text) return Promise.resolve(null);
  return withLock(async () => {
    const readings = await readReadings();
    const id = readingId(doc);
    const old = readings[id];
    const same = old && old.doc.mode === doc.mode && (old.doc.sentences || []).length === (doc.sentences || []).length;
    const { active, ...rest } = doc;
    readings[id] = {
      id,
      doc: rest,
      ts: old?.ts || now,
      lastOpen: now,
      // 文章内容变了（句数不同），旧的进度就对不上了
      active: Number.isInteger(active) && active >= 0 ? active : same ? old.active : -1,
      read: same ? old.read || 0 : 0
    };
    pruneReadings(readings);
    await chrome.storage.local.set({ readings });
    return readings[id];
  });
}

export function updateReading(id, patch, now = Date.now()) {
  return withLock(async () => {
    const readings = await readReadings();
    const entry = readings[id];
    if (!entry) return null;
    if (Number.isInteger(patch?.active) && patch.active >= 0) entry.active = patch.active;
    // 进度只增不减：换个标签页重新打开时是从头数的
    if (Number.isFinite(patch?.read)) entry.read = Math.max(entry.read || 0, Math.floor(patch.read));
    entry.lastOpen = now;
    await chrome.storage.local.set({ readings });
    return entry;
  });
}

export function listReadings(readings) {
  return Object.values(readings || {}).sort((a, b) => (b.lastOpen || 0) - (a.lastOpen || 0));
}

export function removeReading(id) {
  return withLock(async () => {
    const readings = await readReadings();
    delete readings[id];
    await chrome.storage.local.set({ readings });
  });
}

export function clearReadings() {
  return withLock(() => chrome.storage.local.set({ readings: {} }));
}
