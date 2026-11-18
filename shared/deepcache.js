import { normKey } from './cache.js';
import { withLock } from './lock.js';
import { DEEP_VERSION } from './deep.js';

// 精读结果缓存，独立于翻译记录（storage 键 deep），按句 / 段 / 词分别存
export const DEEP_KEEP_MS = 180 * 24 * 60 * 60 * 1000;
export const DEEP_MAX_ENTRIES = 1500;

export function deepKey(kind, ...parts) {
  return [`v${DEEP_VERSION}`, kind, ...parts.map((p) => normKey(p))].join('|');
}

async function readDeep() {
  const { deep = {} } = await chrome.storage.local.get('deep');
  return deep;
}

export function pruneDeep(deep, now = Date.now()) {
  for (const k of Object.keys(deep)) {
    if (!k.startsWith(`v${DEEP_VERSION}|`) || now - (deep[k].ts || 0) > DEEP_KEEP_MS) delete deep[k];
  }
  const keys = Object.keys(deep);
  if (keys.length > DEEP_MAX_ENTRIES) {
    keys
      .sort((a, b) => (deep[a].lastHit || deep[a].ts) - (deep[b].lastHit || deep[b].ts))
      .slice(0, keys.length - DEEP_MAX_ENTRIES)
      .forEach((k) => delete deep[k]);
  }
  return deep;
}

export function getDeep(key) {
  return withLock(async () => {
    const deep = await readDeep();
    const entry = deep[key];
    if (!entry || Date.now() - (entry.ts || 0) > DEEP_KEEP_MS) return null;
    entry.lastHit = Date.now();
    await chrome.storage.local.set({ deep });
    return entry;
  });
}

export function putDeep(key, data, model, usage) {
  return withLock(async () => {
    const deep = await readDeep();
    deep[key] = { data, model, usage: usage || null, ts: Date.now(), lastHit: Date.now() };
    pruneDeep(deep);
    await chrome.storage.local.set({ deep });
    return deep[key];
  });
}

export function clearDeep() {
  return withLock(() => chrome.storage.local.set({ deep: {} }));
}
