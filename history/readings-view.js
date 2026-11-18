import { readReadings, listReadings, removeReading, clearReadings } from '../shared/readings.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtTime = (ts) => (ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '—');

function host(url) {
  try {
    return new URL(url).host;
  } catch (_) {
    return '';
  }
}

function rowHtml(entry) {
  const doc = entry.doc || {};
  const article = doc.mode === 'article';
  const total = article ? (doc.sentences || []).length : 0;
  const paras = article ? (doc.items || []).filter((it) => it.kind === 'p').length : 0;
  const read = Math.min(entry.read || 0, total);
  const title = article ? doc.title || doc.url || '（无标题）' : doc.text || '';
  const web = /^https?:/.test(doc.url || '');
  const source = article ? host(doc.url) : [host(doc.url), doc.title].filter(Boolean).join(' · ');
  const progress = !article
    ? '<span class="tag">选段</span>'
    : read >= total
      ? '<span class="tag ok">已读完</span>'
      : `<span class="tag">${Math.round((read / total) * 100)}%</span><div class="sub">已精读 ${read} / ${total} 句</div>`;
  return `<tr data-id="${esc(entry.id)}">
    <td><a class="reading-title" href="../reader/reader.html?id=${encodeURIComponent(entry.id)}" target="_blank">${esc(title.length > 160 ? title.slice(0, 160) + '…' : title)}</a>
      ${source ? `<div class="sub">${esc(source)}</div>` : ''}</td>
    <td class="review-col">${article ? `${paras} 段 ${total} 句` : '—'}</td>
    <td class="review-col">${progress}</td>
    <td class="time-col">${fmtTime(entry.lastOpen)}<div class="sub">首次 ${fmtTime(entry.ts)}</div></td>
    <td class="op-col">${web ? `<a class="btn" href="${esc(doc.url)}" target="_blank" rel="noopener">原网页</a>` : ''}<button data-del style="margin-left:6px">删除</button></td>
  </tr>`;
}

export async function initReadings() {
  let entries = [];
  let keyword = '';

  function render() {
    const kw = keyword.trim().toLowerCase();
    const rows = entries.filter((e) => {
      if (!kw) return true;
      const d = e.doc || {};
      return [d.title, d.url, d.text, ...(d.sentences || [])].some((t) => String(t || '').toLowerCase().includes(kw));
    });
    $('readingRows').innerHTML = rows.map(rowHtml).join('');
    $('readingEmpty').hidden = rows.length > 0;
    $('readingCount').textContent = entries.length ? String(entries.length) : '';
    const articles = entries.filter((e) => e.doc?.mode === 'article');
    $('readingSummary').innerHTML = entries.length
      ? `<span>文章 <b>${articles.length}</b> 篇</span><span>选段 <b>${entries.length - articles.length}</b> 条</span><span class="muted">点标题重新打开；逐句结果来自精读缓存，读过的句子不再消耗 token</span>`
      : '';
  }

  async function load() {
    entries = listReadings(await readReadings());
    render();
  }

  $('readingSearch').addEventListener('input', (e) => {
    keyword = e.target.value;
    render();
  });
  $('readingRows').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    await removeReading(del.closest('tr').dataset.id);
    await load();
  });
  $('clearReadings').addEventListener('click', async () => {
    if (!confirm('清空全部精读记录？（不影响精读缓存和生词本）')) return;
    await clearReadings();
    await load();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.readings) load();
  });

  await load();
  return {
    enter(view) {
      if (view === 'readings') load();
    }
  };
}
