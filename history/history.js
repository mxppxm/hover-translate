import { readCache, listEntries, removeEntry, clearCache, setStar } from '../shared/cache.js';
import { getConfig } from '../shared/config.js';
import { estimateCost, formatCost, formatTokens } from '../shared/usage.js';
import { initVocab } from './vocab-view.js';
import { initReadings } from './readings-view.js';

const state = { entries: [], keyword: '', onlyStar: false };
const cfg = await getConfig();

const tbody = document.getElementById('rows');
const empty = document.getElementById('empty');
const summary = document.getElementById('summary');
const search = document.getElementById('search');
const filter = document.getElementById('filter');

const fmt = (ts) => (ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '—');

function visible() {
  const kw = state.keyword.trim().toLowerCase();
  return state.entries.filter((e) => {
    if (state.onlyStar && !e.star) return false;
    if (!kw) return true;
    return (e.text || '').toLowerCase().includes(kw) || (e.translation || '').toLowerCase().includes(kw);
  });
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const old = btn.textContent;
  btn.textContent = '已复制';
  setTimeout(() => {
    btn.textContent = old;
  }, 1200);
}

function renderSummary(stats) {
  const cost = estimateCost(stats, cfg);
  const items = [
    `记录 <b>${state.entries.length}</b> 条`,
    `模型请求 <b>${stats.misses || 0}</b> 次`,
    `缓存命中 <b>${stats.hits || 0}</b> 次`,
    `累计 tokens <b>${formatTokens(stats.tokensTotal)}</b>（入 ${formatTokens(stats.tokensIn)} / 出 ${formatTokens(stats.tokensOut)}）`,
    cost === null
      ? '<span class="muted">未配置单价，填好后显示预估费用</span>'
      : `预估费用 <span class="cost">${formatCost(cost)}</span>`
  ];
  summary.innerHTML = items.map((t) => `<span>${t}</span>`).join('');
}

function render() {
  const rows = visible();
  tbody.innerHTML = '';
  empty.hidden = rows.length > 0;
  for (const entry of rows) {
    const tr = document.createElement('tr');

    const starCell = document.createElement('td');
    const star = document.createElement('button');
    star.className = 'star' + (entry.star ? ' on' : '');
    star.textContent = entry.star ? '★' : '☆';
    star.title = entry.star ? '取消收藏' : '收藏（收藏项置顶）';
    star.addEventListener('click', async () => {
      await setStar(entry.text, !entry.star);
      await load();
    });
    starCell.appendChild(star);

    const srcCell = document.createElement('td');
    srcCell.className = 'src-col';
    srcCell.textContent = entry.text;

    const outCell = document.createElement('td');
    outCell.textContent = entry.translation;

    const tokenCell = document.createElement('td');
    tokenCell.className = 'token-col';
    if (entry.usage) {
      tokenCell.innerHTML = `<b>${formatTokens(entry.usage.total)}</b><br>入 ${formatTokens(entry.usage.input)} / 出 ${formatTokens(entry.usage.output)}`;
      tokenCell.title = entry.usage.cachedInput
        ? `缓存输入 ${formatTokens(entry.usage.cachedInput)}，推理 ${formatTokens(entry.usage.reasoning)}`
        : `推理 ${formatTokens(entry.usage.reasoning)}`;
    } else {
      tokenCell.textContent = '—';
    }

    const metaCell = document.createElement('td');
    metaCell.className = 'meta-col';
    const badge = document.createElement('span');
    badge.className = 'badge' + (entry.source === 'model' ? ' model' : '');
    badge.textContent = entry.source === 'model' ? '模型' : '缓存';
    const modelName = document.createElement('div');
    modelName.className = 'model-name';
    modelName.textContent = entry.model || '';
    metaCell.append(badge, modelName);

    const timeCell = document.createElement('td');
    timeCell.className = 'time-col';
    timeCell.textContent = fmt(entry.lastHit || entry.ts) + (entry.hits ? ' · ' + entry.hits + '次' : '');

    const opCell = document.createElement('td');
    opCell.className = 'op-col';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', () => copy(entry.translation, copyBtn));
    const delBtn = document.createElement('button');
    delBtn.textContent = '删除';
    delBtn.style.marginLeft = '6px';
    delBtn.addEventListener('click', async () => {
      await removeEntry(entry.key);
      await load();
    });
    opCell.append(copyBtn, delBtn);

    tr.append(starCell, srcCell, outCell, tokenCell, metaCell, timeCell, opCell);
    tbody.appendChild(tr);
  }
}

async function load() {
  const { cache, stats } = await readCache();
  state.entries = listEntries(cache);
  renderSummary(stats);
  render();
}

search.addEventListener('input', () => {
  state.keyword = search.value;
  render();
});
filter.addEventListener('change', () => {
  state.onlyStar = filter.value === 'star';
  render();
});
document.getElementById('clear').addEventListener('click', async () => {
  if (!confirm('清空全部翻译记录？')) return;
  await clearCache();
  await load();
});

await load();

const vocabView = await initVocab();
const readingsView = await initReadings();

function route() {
  const view = ['records', 'readings', 'vocab', 'review'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'records';
  document.querySelectorAll('main[data-view]').forEach((m) => {
    m.hidden = m.dataset.view !== view;
  });
  document.querySelectorAll('[data-tools]').forEach((t) => {
    t.hidden = t.dataset.tools !== view;
  });
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === view));
  document.title = { records: '翻译记录', readings: '精读记录', vocab: '生词本', review: '复习' }[view] + ' · 划词翻译';
  vocabView.enter(view);
  readingsView.enter(view);
}
window.addEventListener('hashchange', route);
route();
