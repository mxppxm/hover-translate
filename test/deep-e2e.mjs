// 精读 + 生词本端到端：真实 Chrome + 真实模型（会消耗少量额度）
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '..');
const FIXTURE_HTML = fs.readFileSync(path.join(__dirname, 'fixture.html'), 'utf8');
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(FIXTURE_HTML);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const FIXTURE = `http://127.0.0.1:${server.address().port}/fixture.html`;
const EXE =
  process.env.CHROME_EXE ||
  process.env.HOME + '/.cache/puppeteer/chrome/mac_arm-148.0.7778.97/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};
async function until(fn, timeout = 60000, interval = 300) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last && last.ok) return last;
    await sleep(interval);
  }
  return last;
}

const browser = await puppeteer.launch({
  executablePath: EXE,
  headless: false,
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1200,900',
    '--window-position=-2400,-1400',
    '--no-first-run',
    '--no-default-browser-check',
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`
  ]
});

let workerTarget = null;
for (let i = 0; i < 40 && !workerTarget; i++) {
  workerTarget = browser.targets().find((t) => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
  if (!workerTarget) await sleep(250);
}
check('扩展加载', !!workerTarget);
if (!workerTarget) process.exit(1);
const extensionId = new URL(workerTarget.url()).host;
const worker = await workerTarget.worker();
const storage = (keys) => worker.evaluate((keys) => new Promise((r) => chrome.storage.local.get(keys, r)), keys);

const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 900 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => process.env.DEBUG && console.log('CONSOLE', m.type(), m.text()));
await page.goto(FIXTURE, { waitUntil: 'load' });
await sleep(600);

async function selectText(id, start, end) {
  await page.evaluate((id) => document.getElementById(id).scrollIntoView({ block: 'center' }), id);
  await sleep(400);
  return page.evaluate(
    (id, start, end) => {
      const el = document.getElementById(id);
      const node = el.firstChild;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end ?? node.length);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return sel.toString();
    },
    id,
    start,
    end
  );
}

const panelState = () =>
  page.evaluate(() => {
    const root = document.getElementById('__hover_translate_deep__')?.shadowRoot;
    if (!root) return { open: false };
    const panel = root.querySelector('.panel');
    const sents = [...root.querySelectorAll('.sent[data-i]')];
    return {
      open: !panel.classList.contains('hidden'),
      meta: root.querySelector('.meta').textContent,
      count: sents.length,
      ready: sents.filter((s) => s.querySelector('.zh')).length,
      errors: sents.map((s) => s.querySelector('.sent-err')?.textContent || '').filter(Boolean),
      spans: root.querySelectorAll('.r').length,
      roles: [...new Set([...root.querySelectorAll('.r')].map((r) => r.className.replace('r r-', '')))],
      zh: sents.map((s) => s.querySelector('.zh')?.textContent || ''),
      howToRead: root.querySelectorAll('.read').length,
      words: root.querySelectorAll('[data-view="sents"] [data-add]').length,
      gistTabHidden: root.querySelector('[data-tab="gist"]').hidden,
      gist: root.querySelector('.gist')?.textContent || '',
      fromCache: root.querySelectorAll('.from-cache').length,
      enMatches: sents.every((s) => !s.querySelector('.zh') || s.querySelector('.en').textContent.trim().length > 20)
    };
  });

// 1. 划选整段 → 卡片出现精读按钮
await selectText('para', 0);
const cardDeep = await until(() =>
  page.evaluate(() => {
    const root = document.getElementById('__hover_translate_root__')?.shadowRoot;
    const btn = root?.querySelector('.act-deep');
    const vocabBtn = root?.querySelector('.act-vocab');
    return { ok: !!btn && btn.style.display !== 'none', vocabHidden: vocabBtn?.style.display === 'none' };
  })
);
check('整段划选后卡片上有精读按钮', !!cardDeep?.ok);
check('整段时不显示加入生词本按钮', !!cardDeep?.vocabHidden);

// 2. 点精读 → 侧栏逐句出结果
const t0 = Date.now();
await page.evaluate(() => document.getElementById('__hover_translate_root__').shadowRoot.querySelector('.act-deep').click());
const opened = await until(async () => {
  const s = await panelState();
  return { ...s, ok: s.open };
}, 5000);
check('点精读后右侧侧栏打开', !!opened?.ok);
const full = await until(async () => {
  const s = await panelState();
  return { ...s, ok: s.count === 2 && s.ready === 2 && s.gist && /tokens|命中/.test(s.meta) };
}, 90000, 500);
const elapsed = Date.now() - t0;
console.log('      ', JSON.stringify({ ...full, zh: full?.zh?.map((z) => z.slice(0, 30)) }));
check('分成 2 句并全部出结果', full?.count === 2 && full?.ready === 2, `${full?.ready}/${full?.count}，${elapsed}ms`);
check('无单句报错', (full?.errors || []).length === 0, (full?.errors || []).join(' | '));
check('译文为中文', (full?.zh || []).every((z) => /[一-龥]/.test(z)));
check('结构着色片段 ≥ 4 个且含谓语', full?.spans >= 4 && full?.roles.includes('verb'), JSON.stringify(full?.roles));
check('每句都有「怎么读」', full?.howToRead === 2);
check('有重点词可加入生词本', full?.words >= 1, String(full?.words));
check('多句时显示段落主旨', full?.gistTabHidden === false && /[一-龥]/.test(full?.gist || ''), full?.gist?.slice(0, 40));
check('完成后头部显示 tokens', /tokens/.test(full?.meta || ''), full?.meta);
check('原句文本完整渲染', !!full?.enMatches);
await page.screenshot({ path: path.join(__dirname, '..', 'screenshot-deep.png') });

// 3. 点句中单词 → 语境释义浮层
await page.evaluate(() => {
  const root = document.getElementById('__hover_translate_deep__').shadowRoot;
  const tok = [...root.querySelectorAll('.tok')].find((t) => t.dataset.w === 'sophisticated');
  tok.click();
});
const pop = await until(
  () =>
    page.evaluate(() => {
      const root = document.getElementById('__hover_translate_deep__').shadowRoot;
      const p = root.querySelector('.pop');
      const mean = p.querySelector('.mean')?.textContent || '';
      return { ok: !p.hidden && /[一-龥]/.test(mean), mean, hasAdd: !!p.querySelector('[data-add]') };
    }),
  30000
);
check('点词弹出语境释义', !!pop?.ok, pop?.mean);
check('释义浮层可加入生词本', !!pop?.hasAdd);

// 4. 浮层里加入生词本
await page.evaluate(() => document.getElementById('__hover_translate_deep__').shadowRoot.querySelector('.pop [data-add]').click());
const v1 = await until(async () => {
  const { vocab = {} } = await storage('vocab');
  const e = vocab['sophisticated'];
  return { ok: !!e, e };
}, 5000);
check('生词写入存储并带原句与来源', !!v1?.ok && /pattern matching/.test(v1.e.sentence) && v1.e.url.startsWith('http'), JSON.stringify(v1?.e || {}).slice(0, 160));
const btnOn = await page.evaluate(() => document.getElementById('__hover_translate_deep__').shadowRoot.querySelector('.pop [data-add]').textContent);
check('按钮变为已加入', /已加入/.test(btnOn), btnOn);

// 5. 页面里标出生词
const marked = await until(() => page.evaluate(() => ({ ok: (CSS.highlights.get('ht-vocab')?.size || 0) > 0, n: CSS.highlights.get('ht-vocab')?.size || 0 })), 6000);
check('网页中标出生词本里的词（Highlight API，不改 DOM）', !!marked?.ok, String(marked?.n));
const domClean = await page.evaluate(() => document.getElementById('para').childNodes.length === 1);
check('页面 DOM 未被改动', domClean);

// 6. 侧栏内选中文字不触发划词卡片
await page.evaluate(() => {
  const root = document.getElementById('__hover_translate_deep__').shadowRoot;
  root.querySelector('.zh').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
  const range = document.createRange();
  range.selectNodeContents(root.querySelector('.zh'));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
});
await sleep(800);
const cardShown = await page.evaluate(() => {
  const root = document.getElementById('__hover_translate_root__')?.shadowRoot;
  const wrap = root?.querySelector('.card')?.parentElement;
  return !!wrap && wrap.style.display !== 'none';
});
check('侧栏里选文字不弹划词卡片', !cardShown);

// 7. Esc 关闭，再次精读同一段全部命中缓存
await page.keyboard.press('Escape'); // 关浮层
await page.keyboard.press('Escape'); // 关侧栏
await sleep(300);
const closed = await panelState();
check('Esc 关闭侧栏', closed.open === false);
await page.evaluate(() => window.getSelection().removeAllRanges());
await selectText('para', 0);
await sleep(300);
// 模拟快捷键 / 右键：后台向页面发 HT_DEEP_SELECTION
const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id);
await worker.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'HT_DEEP_SELECTION' }), tabId);
const cached = await until(async () => {
  const s = await panelState();
  return { ...s, ok: s.open && s.ready === 2 && /命中缓存/.test(s.meta) };
}, 8000, 200);
check('快捷键路径打开侧栏，二次精读全部命中缓存', !!cached?.ok, cached?.meta);
check('命中缓存的句子有标记', cached?.fromCache === 2, String(cached?.fromCache));

// 8. 单词卡片：加入生词本带语境原句
await page.keyboard.press('Escape');
await page.evaluate(() => window.getSelection().removeAllRanges());
await sleep(300);
await selectText('second', 27, 31);
const wordCard = await until(
  () =>
    page.evaluate(() => {
      const root = document.getElementById('__hover_translate_root__')?.shadowRoot;
      const v = root?.querySelector('.act-vocab');
      const out = root?.querySelector('.out')?.textContent || '';
      return { ok: !!v && v.style.display !== 'none' && /[一-龥]/.test(out), deepHidden: root.querySelector('.act-deep').style.display === 'none' };
    }),
  45000
);
check('单词卡片显示加入生词本按钮、不显示精读', !!wordCard?.ok && wordCard.deepHidden);
await page.evaluate(() => document.getElementById('__hover_translate_root__').shadowRoot.querySelector('.act-vocab').click());
const v2 = await until(async () => {
  const { vocab = {} } = await storage('vocab');
  return { ok: !!vocab.moss, e: vocab.moss };
}, 5000);
check('卡片加入的生词带段落里的原句', v2?.e?.sentence === 'A rolling stone gathers no moss.', JSON.stringify(v2?.e || {}).slice(0, 160));

// 9. 生词本页与复习
const hp = await browser.newPage();
await hp.goto(`chrome-extension://${extensionId}/history/history.html#vocab`);
await sleep(800);
const vocabPage = await hp.evaluate(() => ({
  rows: document.querySelectorAll('#vocabRows tr').length,
  marked: document.querySelectorAll('#vocabRows mark').length,
  due: document.getElementById('dueCount').textContent,
  visible: !document.querySelector('main[data-view="vocab"]').hidden
}));
check('生词本页列出 2 个词并高亮原句中的词', vocabPage.visible && vocabPage.rows === 2 && vocabPage.marked >= 2, JSON.stringify(vocabPage));
await hp.evaluate(() => {
  location.hash = '#review';
});
await sleep(400);
const rv1 = await hp.evaluate(() => ({ word: document.querySelector('.rv-word')?.textContent || '', flip: !!document.querySelector('[data-flip]') }));
check('复习页出卡片', !!rv1.word && rv1.flip, rv1.word);
await hp.keyboard.press('Space');
await sleep(150);
const rv2 = await hp.evaluate(() => ({ back: !document.querySelector('.rv-back').hidden, rates: document.querySelectorAll('[data-rate]').length }));
check('空格显示释义与三个评分按钮', rv2.back && rv2.rates === 3);
await hp.keyboard.press('3');
await sleep(300);
await hp.keyboard.press('Space');
await sleep(150);
await hp.keyboard.press('1');
await sleep(300);
const afterRate = await storage('vocab');
const reviews = Object.values(afterRate.vocab).map((e) => e.review);
check(
  '评分后更新复习进度（认识 → 1 天，不认识 → 10 分钟）',
  reviews.some((r) => r.interval === 1) && reviews.some((r) => r.lapses === 1),
  JSON.stringify(reviews.map((r) => ({ i: r.interval, l: r.lapses })))
);
const rv3 = await hp.evaluate(() => document.querySelector('.rv-progress')?.textContent || document.querySelector('.rv-empty')?.textContent || '');
check('不认识的词本轮末尾再出现', /剩余 1/.test(rv3), rv3);
await hp.screenshot({ path: path.join(__dirname, '..', 'screenshot-review.png') });

const stats = (await storage('stats')).stats || {};
check('精读用量计入统计', stats.tokenRequests >= 4 && stats.tokensTotal > 0, JSON.stringify(stats));
check('无页面 JS 报错', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
server.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
