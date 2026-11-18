import { addUsage, normalizeUsage } from './usage.js';
import { withLock } from './lock.js';

export const KEEP_MS = 180 * 24 * 60 * 60 * 1000;
export const MAX_ENTRIES = 3000;
export const EMPTY_STATS = {
  hits: 0,
  misses: 0,
  tokensIn: 0,
  tokensOut: 0,
  tokensTotal: 0,
  tokensCached: 0,
  tokenRequests: 0
};

// 记录格式版本：2 起单词/短语带例句，低于此版本的旧记录会重新请求一次
export const ENTRY_VERSION = 2;

export function normKey(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export async function readCache() {
  const { cache = {}, stats = {} } = await chrome.storage.local.get(['cache', 'stats']);
  return { cache, stats: { ...EMPTY_STATS, ...stats } };
}

async function bumpStatUnlocked(bucket) {
  const { stats } = await readCache();
  stats[bucket] = (stats[bucket] || 0) + 1;
  await chrome.storage.local.set({ stats });
  return stats[bucket];
}

export function bumpStat(bucket) {
  return withLock(() => bumpStatUnlocked(bucket));
}

// 精读等其他功能的模型调用也计入同一份统计：命中计 hits，真实请求计 misses + tokens
export function recordUsage(usage) {
  return withLock(async () => {
    const { stats } = await readCache();
    stats.misses = (stats.misses || 0) + 1;
    addUsage(stats, usage);
    await chrome.storage.local.set({ stats });
    return stats;
  });
}

export function getEntry(text) {
  return withLock(() => getEntryUnlocked(text));
}

async function getEntryUnlocked(text) {
  const key = normKey(text);
  if (!key) return null;
  const { cache } = await readCache();
  const entry = cache[key];
  if (!entry) return null;
  if (entry.ts && Date.now() - entry.ts > KEEP_MS) return null;
  if ((entry.v || 1) < ENTRY_VERSION) return null;
  entry.hits = (entry.hits || 0) + 1;
  entry.lastHit = Date.now();
  cache[key] = entry;
  await chrome.storage.local.set({ cache });
  await bumpStatUnlocked('hits');
  return entry;
}

export function prune(cache) {
  const now = Date.now();
  let keys = Object.keys(cache).filter((k) => !cache[k].ts || now - cache[k].ts <= KEEP_MS);
  if (keys.length > MAX_ENTRIES) {
    keys = keys.sort((a, b) => (cache[a].lastHit || cache[a].ts) - (cache[b].lastHit || cache[b].ts));
    keys.slice(0, keys.length - MAX_ENTRIES).forEach((k) => delete cache[k]);
  }
  const keep = new Set(keys);
  Object.keys(cache).forEach((k) => {
    if (!keep.has(k)) delete cache[k];
  });
  return cache;
}

export function putEntry(...args) {
  return withLock(() => putEntryUnlocked(...args));
}

async function putEntryUnlocked(text, translation, model, source, usage, example = null) {
  const key = normKey(text);
  if (!key || !translation) return null;
  const { cache, stats } = await readCache();
  cache[key] = {
    text: String(text).replace(/\s+/g, ' ').trim(),
    translation,
    example: example || null,
    v: ENTRY_VERSION,
    model,
    source,
    usage: normalizeUsage(usage),
    ts: Date.now(),
    hits: cache[key]?.hits || 0,
    lastHit: Date.now()
  };
  prune(cache);
  if (source === 'model') {
    stats.misses = (stats.misses || 0) + 1;
    addUsage(stats, usage);
  }
  await chrome.storage.local.set({ cache, stats });
  return cache[key];
}

export function setStar(text, star) {
  return withLock(async () => {
  const key = normKey(text);
  const { cache } = await readCache();
  if (!cache[key]) return null;
  cache[key].star = !!star;
  await chrome.storage.local.set({ cache });
  return cache[key];
  });
}

export function removeEntry(key) {
  return withLock(async () => {
    const { cache } = await readCache();
    delete cache[key];
    await chrome.storage.local.set({ cache });
  });
}

export function clearCache() {
  return withLock(() => chrome.storage.local.set({ cache: {}, stats: { ...EMPTY_STATS } }));
}

export function listEntries(cache) {
  return Object.entries(cache)
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => {
      if (!!a.star !== !!b.star) return a.star ? -1 : 1;
      return (b.lastHit || b.ts) - (a.lastHit || a.ts);
    });
}
