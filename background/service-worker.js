import { getConfig } from '../shared/config.js';
import { bumpStat, getEntry, putEntry, recordUsage, setStar } from '../shared/cache.js';
import { translateText } from '../shared/model.js';
import { estimateCost, formatCost, formatUsage, sumUsage } from '../shared/usage.js';
import {
  analyzeGist,
  analyzeOutline,
  analyzeSentence,
  checkArticle,
  checkDeepInput,
  lookupWord,
  outlineInput,
  prepareArticle,
  segmentSentence,
  textDigest
} from '../shared/deep.js';
import { deepKey, getDeep, putDeep } from '../shared/deepcache.js';
import { addWord, readVocab, removeWord } from '../shared/vocab.js';
import { normKey } from '../shared/cache.js';
import { saveReading, updateReading } from '../shared/readings.js';

const MENU_ID = 'hover-translate-selection';
const MENU_DEEP_ID = 'hover-translate-deep';
const MENU_ARTICLE_ID = 'hover-translate-article';
const DEEP_CONCURRENCY = 3;

export async function translate(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, error: '没有选中文本' };
  if (raw.length > 4000) return { ok: false, error: '选中内容过长（上限 4000 字符）' };

  const cached = await getEntry(raw);
  if (cached) {
    return {
      ok: true,
      source: 'cache',
      translation: cached.translation,
      example: cached.example || null,
      model: cached.model,
      cachedAt: cached.ts,
      hits: cached.hits || 1,
      usage: cached.usage || null,
      usageText: '本次未消耗 token（命中记录）',
      costText: formatCost(0)
    };
  }

  try {
    const cfg = await getConfig();
    let out = await translateText(raw, cfg);
    // 单个单词偶尔漏掉例句，补问一次，避免没有例句的结果被永久缓存
    if (!out.example && /^[A-Za-z][A-Za-z'-]*$/.test(raw)) {
      const retry = await translateText(raw, { ...cfg, requireExample: true }).catch(() => null);
      if (retry?.example) out = { ...retry, usage: sumUsage(out.usage, retry.usage) };
      else if (retry) out = { ...out, usage: sumUsage(out.usage, retry.usage) };
    }
    await putEntry(raw, out.translation, out.model, 'model', out.usage, out.example);
    return {
      ok: true,
      source: 'model',
      translation: out.translation,
      example: out.example,
      model: out.model,
      cachedAt: Date.now(),
      hits: 1,
      usage: out.usage,
      usageText: formatUsage(out.usage) || '接口未返回 token 用量',
      costText: formatCost(estimateCost(out.usage, cfg))
    };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// 带缓存的精读子任务：命中计 hits，真实请求计 misses + tokens
async function cachedCall(key, fn) {
  const hit = await getDeep(key);
  if (hit) {
    await bumpStat('hits');
    return { data: hit.data, source: 'cache', usage: null };
  }
  try {
    const out = await fn();
    await recordUsage(out.usage);
    await putDeep(key, out.data, out.model, out.usage);
    return { data: out.data, source: 'model', usage: out.usage };
  } catch (err) {
    if (err?.usage) await recordUsage(err.usage);
    throw err;
  }
}

async function runPool(items, limit, worker) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
}

export async function deepRead(text, post, isAlive = () => true) {
  const checked = checkDeepInput(text);
  if (!checked.ok) return post({ type: 'error', error: checked.error });
  const { sentences } = checked;
  const cfg = await getConfig();
  const level = cfg.level || 'cet6';
  post({ type: 'init', sentences });

  let total = null;
  const add = (u) => {
    total = sumUsage(total, u);
  };

  const sentenceJob = runPool(sentences, DEEP_CONCURRENCY, async (sentence, i) => {
    if (!isAlive()) return;
    try {
      const res = await cachedCall(deepKey('s', level, sentence), () =>
        analyzeSentence(sentence, { prev: sentences[i - 1], next: sentences[i + 1] }, cfg)
      );
      add(res.usage);
      post({ type: 'sentence', index: i, source: res.source, data: { ...res.data, segments: segmentSentence(sentence, res.data.spans) } });
    } catch (err) {
      post({ type: 'sentence-error', index: i, error: err?.message || String(err) });
    }
  });

  const gistJob =
    sentences.length > 1
      ? cachedCall(deepKey('g', sentences.join(' ')), () => analyzeGist(sentences, cfg))
          .then((res) => {
            add(res.usage);
            post({ type: 'gist', source: res.source, data: res.data });
          })
          .catch((err) => post({ type: 'gist-error', error: err?.message || String(err) }))
      : Promise.resolve();

  await Promise.all([sentenceJob, gistJob]);
  const cost = estimateCost(total, cfg);
  post({
    type: 'done',
    usage: total,
    usageText: total ? formatUsage(total) : '全部命中缓存，未消耗 token',
    costText: cost === null ? '' : formatCost(cost)
  });
}

export async function deepRetry(text, index, post) {
  const checked = checkDeepInput(text);
  if (!checked.ok) return post({ type: 'sentence-error', index, error: checked.error });
  const { sentences } = checked;
  const cfg = await getConfig();
  const sentence = sentences[index];
  try {
    const res = await cachedCall(deepKey('s', cfg.level || 'cet6', sentence), () =>
      analyzeSentence(sentence, { prev: sentences[index - 1], next: sentences[index + 1] }, cfg)
    );
    post({ type: 'sentence', index, source: res.source, data: { ...res.data, segments: segmentSentence(sentence, res.data.spans) } });
  } catch (err) {
    post({ type: 'sentence-error', index, error: err?.message || String(err) });
  }
}

// 全文精读：侧栏按阅读进度一批批送句子过来，这里不保存文章状态（service worker 随时可能被回收）
export async function analyzeBatch(items, post, isAlive = () => true) {
  const cfg = await getConfig();
  const level = cfg.level || 'cet6';
  let total = null;
  await runPool(items, DEEP_CONCURRENCY, async (item) => {
    const sentence = String(item?.sentence || '').trim();
    const index = item?.index;
    if (!isAlive() || !sentence) return;
    try {
      const res = await cachedCall(deepKey('s', level, sentence), () => analyzeSentence(sentence, { prev: item.prev, next: item.next }, cfg));
      total = sumUsage(total, res.usage);
      post({ type: 'sentence', index, source: res.source, data: { ...res.data, segments: segmentSentence(sentence, res.data.spans) } });
    } catch (err) {
      post({ type: 'sentence-error', index, error: err?.message || String(err) });
    }
  });
  return total;
}

export async function articleOutline(title, items, post) {
  const cfg = await getConfig();
  try {
    const res = await cachedCall(deepKey('a', textDigest(outlineInput(items))), () => analyzeOutline(title, items, cfg));
    post({ type: 'gist', source: res.source, data: res.data });
    return res.usage;
  } catch (err) {
    post({ type: 'gist-error', error: err?.message || String(err) });
    return null;
  }
}

// 「在新标签页打开」：内容存进精读记录，独立页面按 id 取
async function openReader(doc, fromTab) {
  const entry = await saveReading(doc);
  if (!entry) throw new Error('没有可打开的内容');
  await chrome.tabs.create({
    url: chrome.runtime.getURL('reader/reader.html') + '?id=' + entry.id,
    ...(fromTab?.index !== undefined ? { index: fromTab.index + 1 } : {}),
    ...(fromTab?.id ? { openerTabId: fromTab.id } : {})
  });
}

async function wordLookup(word, sentence) {
  const w = String(word || '').trim();
  if (!w) return { ok: false, error: '没有单词' };
  try {
    const cfg = await getConfig();
    const res = await cachedCall(deepKey('w', w, sentence || ''), () => lookupWord(w, sentence || w, cfg));
    return { ok: true, source: res.source, data: res.data };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: '划词翻译：译为中文',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: MENU_DEEP_ID,
      title: '划词翻译：精读这段',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: MENU_ARTICLE_ID,
      title: '划词翻译：精读全文',
      contexts: ['page']
    });
  });
}

chrome.runtime.onInstalled.addListener(setupMenus);
// 0.3 早期版本把新标签页的内容存在 reader 键下，已并入精读记录
chrome.runtime.onInstalled.addListener(() => chrome.storage.local.remove('reader'));
chrome.runtime.onStartup.addListener(setupMenus);

function showDeepInTop(tabId, text) {
  // 精读侧栏总是开在顶层页面，避免挤在小 iframe 里
  return chrome.tabs.sendMessage(tabId, { type: 'HT_DEEP_SHOW', text }, { frameId: 0 }).catch(() => {});
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === MENU_ID) {
    chrome.tabs
      .sendMessage(tab.id, { type: 'HT_TRANSLATE_NOW', text: info.selectionText || '' }, { frameId: info.frameId })
      .catch(() => {});
  } else if (info.menuItemId === MENU_DEEP_ID) {
    // 右键给的 selectionText 会丢换行；让选区所在 frame 自己取原文，取不到再用菜单文本
    chrome.tabs
      .sendMessage(tab.id, { type: 'HT_DEEP_SELECTION', fallback: info.selectionText || '' }, { frameId: info.frameId })
      .catch(() => showDeepInTop(tab.id, info.selectionText || ''));
  } else if (info.menuItemId === MENU_ARTICLE_ID) {
    chrome.tabs.sendMessage(tab.id, { type: 'HT_ARTICLE_START' }, { frameId: 0 }).catch(() => {});
  }
});

chrome.commands?.onCommand.addListener((command, tab) => {
  if (command !== 'deep-read' || !tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'HT_DEEP_SELECTION' }).catch(() => {});
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ht-deep') return;
  let alive = true;
  port.onDisconnect.addListener(() => {
    alive = false;
  });
  const post = (msg) => {
    if (!alive) return;
    try {
      port.postMessage(msg);
    } catch (_) {
      alive = false;
    }
  };
  // 全文精读在同一个连接上分多批请求，用量累计后一起报给侧栏
  let total = null;
  const report = async (usage) => {
    if (!usage) return;
    total = sumUsage(total, usage);
    const cost = estimateCost(total, await getConfig());
    post({ type: 'usage', usageText: formatUsage(total), costText: cost === null ? '' : formatCost(cost) });
  };
  port.onMessage.addListener((msg) => {
    if (msg?.type === 'start') deepRead(msg.text, post, () => alive);
    else if (msg?.type === 'retry') deepRetry(msg.text, msg.index, post);
    else if (msg?.type === 'analyze') analyzeBatch(msg.items || [], post, () => alive).then(report);
    else if (msg?.type === 'outline') articleOutline(msg.title || '', msg.items || [], post).then(report);
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'HT_TRANSLATE') {
    translate(msg.text).then(sendResponse);
    return true;
  }
  if (msg?.type === 'HT_STAR') {
    setStar(msg.text, msg.star).then((entry) => sendResponse({ ok: !!entry }));
    return true;
  }
  if (msg?.type === 'HT_DEEP_OPEN') {
    if (sender.tab?.id) showDeepInTop(sender.tab.id, msg.text);
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === 'HT_READER_OPEN') {
    openReader(msg.doc, sender.tab)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }
  if (msg?.type === 'HT_READING_SAVE') {
    saveReading(msg.doc)
      .then((entry) => sendResponse({ ok: !!entry, id: entry?.id || '' }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === 'HT_READING_PROGRESS') {
    updateReading(msg.id, { active: msg.active, read: msg.read }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'HT_ARTICLE_PREPARE') {
    const article = prepareArticle(msg.blocks);
    sendResponse({ ...checkArticle(article), ...article });
    return false;
  }
  if (msg?.type === 'HT_WORD_LOOKUP') {
    wordLookup(msg.word, msg.sentence).then(sendResponse);
    return true;
  }
  if (msg?.type === 'HT_VOCAB_ADD') {
    addWord({ ...msg.entry, url: msg.entry?.url || sender.tab?.url || '', title: msg.entry?.title || sender.tab?.title || '' })
      .then((res) => sendResponse({ ok: !!res, entry: res?.entry || null }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg?.type === 'HT_VOCAB_REMOVE') {
    removeWord(msg.word).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'HT_VOCAB_HAS') {
    readVocab().then((vocab) => {
      const has = {};
      for (const w of msg.words || []) has[w] = !!vocab[normKey(w)];
      sendResponse({ ok: true, has });
    });
    return true;
  }
  if (msg?.type === 'HT_OPEN_HISTORY') {
    chrome.tabs.create({ url: chrome.runtime.getURL('history/history.html') + (msg.hash || '') });
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === 'HT_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
