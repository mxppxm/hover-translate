import { getConfig } from '../shared/config.js';
import { readCache, listEntries } from '../shared/cache.js';
import { estimateCost, formatCost, formatTokens } from '../shared/usage.js';
import { readVocab, listVocab, isDue } from '../shared/vocab.js';

const cfg = await getConfig();
document.getElementById('model').textContent = cfg.model;

const { cache, stats } = await readCache();
const entries = listEntries(cache);
const cost = estimateCost(stats, cfg);

document.getElementById('stats').innerHTML = [
  ['记录条数', entries.length],
  ['缓存命中', stats.hits],
  ['模型请求', stats.misses],
  ['输入 tokens', formatTokens(stats.tokensIn)],
  ['输出 tokens', formatTokens(stats.tokensOut)],
  ['预估费用', cost === null ? '—' : formatCost(cost)]
]
  .map(([label, value]) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`)
  .join('');

document.getElementById('priceHint').hidden = cost !== null;

const auto = document.getElementById('autoTranslate');
auto.checked = cfg.autoTranslate !== false;
auto.addEventListener('change', () => saveConfig({ autoTranslate: auto.checked }));

const speak = document.getElementById('autoSpeak');
speak.checked = cfg.autoSpeak === true;
speak.addEventListener('change', () => saveConfig({ autoSpeak: speak.checked }));

async function saveConfig(patch) {
  const { config = {} } = await chrome.storage.local.get('config');
  await chrome.storage.local.set({ config: { ...config, ...patch } });
}

document.getElementById('openHistory').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('history/history.html') });
});
document.getElementById('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

const vocabList = listVocab(await readVocab());
const dueNow = vocabList.filter((e) => isDue(e)).length;
document.getElementById('vocabBadge').textContent = dueNow ? String(dueNow) : vocabList.length ? String(vocabList.length) : "";
document.getElementById('vocabBadge').classList.toggle('due', dueNow > 0);
document.getElementById('openVocab').title = dueNow ? `待复习 ${dueNow} 个` : `生词 ${vocabList.length} 个`;
document.getElementById('openVocab').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('history/history.html') + (dueNow ? '#review' : '#vocab') });
});

document.getElementById('readPage').addEventListener('click', async () => {
  const hint = document.getElementById('readHint');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'HT_ARTICLE_START' }, { frameId: 0 });
    window.close();
  } catch (_) {
    // 浏览器内置页、扩展商店，或扩展装好之后还没刷新过的页面，都没有注入脚本
    hint.textContent = '这个页面用不了精读。如果是普通网页，刷新一下再试。';
    hint.hidden = false;
  }
});
