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
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: EXE,
  headless: false,
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1000,800',
    '--window-position=-2400,-1400',
    '--no-first-run',
    '--no-default-browser-check',
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`
  ]
});

const extensionId = await (async () => {
  for (let i = 0; i < 40; i++) {
    const target = browser.targets().find((t) => t.url().startsWith('chrome-extension://'));
    if (target) return new URL(target.url()).host;
    await sleep(250);
  }
  return null;
})();
check('MV3 service worker 启动（扩展已加载）', !!extensionId, extensionId || 'no service worker target');
if (!extensionId) {
  await browser.close();
  process.exit(1);
}

const workerTarget = browser.targets().find((t) => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
const worker = await workerTarget.worker();
const readConfig = () => worker.evaluate(() => new Promise((r) => chrome.storage.local.get('config', (v) => r(v.config || {}))));
const patchConfig = (patch) =>
  worker.evaluate(
    (patch) =>
      new Promise((r) => chrome.storage.local.get('config', (v) => chrome.storage.local.set({ config: { ...(v.config || {}), ...patch } }, r))),
    patch
  );

const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 800 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
await page.goto(FIXTURE, { waitUntil: 'load' });
await sleep(600);

async function selectText(id, start, end) {
  return page.evaluate(
    (id, start, end) => {
      const node = document.getElementById(id).firstChild;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
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

async function readCard() {
  return page.evaluate(() => {
    const host = document.getElementById('__hover_translate_root__');
    const shadow = host?.shadowRoot;
    if (!shadow) return null;
    const wrap = shadow?.querySelector('div > .card')?.parentElement;
    if (!wrap || wrap.style.display === 'none') return null;
    const speak = shadow.querySelector('.act-speak');
    return {
      source: { model: '大模型', cache: '缓存命中', error: '出错' }[wrap.dataset.source] || wrap.dataset.source || '',
      hasBadge: !!shadow.querySelector('.src'),
      hasClose: !!shadow.querySelector('.act-close'),
      srcText: shadow.querySelector('.src-text').textContent,
      out: shadow.querySelector('.out').textContent,
      loading: !!shadow.querySelector('.out .loading'),
      footExists: !!shadow.querySelector('.foot'),
      example: shadow.querySelector('.example')?.hidden ? '' : shadow.querySelector('.example .en')?.textContent || '',
      iconsAreSvg: [...shadow.querySelectorAll('.head .icon')].every((b) => !!b.querySelector('svg') && !b.textContent.trim()),
      speakTitle: speak ? speak.title : null,
      top: wrap.style.top,
      left: wrap.style.left
    };
  });
}

async function waitForCard(predicate, timeout = 45000, interval = 300) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await readCard();
    if (last && predicate(last)) return last;
    await sleep(interval);
  }
  return last;
}

const selected1 = await selectText('plain', 0, 44);
check('选区事件触发', selected1.length > 0, JSON.stringify(selected1));

const card1 = await waitForCard((c) => c.out && !c.loading && c.out.length > 0);
check('划词后弹出卡片且拿到译文', !!card1 && card1.out.length > 0, card1 ? card1.source + ' | ' + card1.out.slice(0, 40) : 'no card');
if (card1) {
  check('首次走大模型（source=大模型）', card1.source === '大模型', card1.source);
  check('译文含中文', /[\u4e00-\u9fa5]/.test(card1.out), card1.out.slice(0, 40));
  check('卡片落在选区下方且不溢出视口', parseInt(card1.top, 10) > 120 && parseInt(card1.top, 10) < 760, 'top=' + card1.top);
  check('原文行显示被划词文本', card1.srcText.includes('quick brown fox'), card1.srcText);
  check('卡片不再显示底部模型/token 信息', !card1.footExists, String(card1.footExists));
  check('卡片按钮统一为 SVG 图标', card1.iconsAreSvg, String(card1.iconsAreSvg));
  check('整句不带例句', !card1.example, card1.example);
  check('顶部无来源标签、无关闭按钮', !card1.hasBadge && !card1.hasClose, JSON.stringify({ badge: card1.hasBadge, close: card1.hasClose }));
}

const speakState = await page.evaluate(() => {
  const host = document.getElementById('__hover_translate_root__');
  const btn = host.shadowRoot.querySelector('.act-speak');
  const exists = !!btn;
  const before = btn ? btn.title : null;
  btn.click();
  return { exists, before, on: btn.classList.contains('on'), title: btn.title };
});
check('卡片有朗读按钮（系统/Chrome 语音）', speakState.exists && speakState.before === '朗读原文', JSON.stringify(speakState));
check('点击朗读后进入朗读态', speakState.on && speakState.title === '停止朗读', JSON.stringify(speakState));
await page.evaluate(() => {
  const btn = document.getElementById('__hover_translate_root__').shadowRoot.querySelector('.act-speak');
  if (btn.classList.contains('on')) btn.click();
});

await page.evaluate(() => window.getSelection().removeAllRanges());
await sleep(300);
await page.keyboard.press('Escape');

const t0 = Date.now();
const selected2 = await selectText('plain', 0, 44);
check('同一文本可再次划选', selected2 === selected1, selected2.slice(0, 30));
const card2 = await waitForCard((c) => c.source === '缓存命中', 8000, 150);
const elapsed = Date.now() - t0;
check('重复划词命中记录（source=缓存命中）', !!card2 && card2.source === '缓存命中', card2 ? card2.source + ' | ' + card2.out.slice(0, 30) : 'no card');
check('命中响应快（<3s）', elapsed < 3000, elapsed + 'ms');
check('命中译文与首次一致', !!card1 && !!card2 && card2.out === card1.out, card2?.out?.slice(0, 40) || '');

await page.evaluate(() => window.getSelection().removeAllRanges());
await sleep(200);

const selected3 = await selectText('second', 2, 32);
check('第二段划选触发新请求', selected3.startsWith('rolling stone'), selected3);
const card3 = await waitForCard((c) => c.out && !c.loading && c.out.length > 0);
check('新文本得到新译文', !!card3 && /[\u4e00-\u9fa5]/.test(card3.out || ''), card3?.out?.slice(0, 40) || 'no card');
await page.evaluate(() => window.getSelection().removeAllRanges());
await sleep(400);
await selectText('second', 27, 31);
const cardWord = await waitForCard((c) => c.srcText === 'moss' && c.out && !c.loading);
check('单词带英文例句', !!cardWord && /moss/i.test(cardWord.example || ''), cardWord ? JSON.stringify({ src: cardWord.srcText, out: cardWord.out, ex: cardWord.example }) : 'no card');
await page.screenshot({ path: path.join(__dirname, '..', 'screenshot-card.png') });

await patchConfig({ inPrice: 2, outPrice: 8 });
await page.evaluate(() => window.getSelection().removeAllRanges());
await sleep(400);
await selectText('third', 0, 22);
const cardCost = await waitForCard((c) => c.out && !c.loading, 45000, 200);
check('第三段划选得到译文', !!cardCost && /[\u4e00-\u9fa5]/.test(cardCost.out || ''), cardCost?.out || 'no card');

const storage = await worker.evaluate(
  () =>
    new Promise((resolve) => {
      chrome.storage.local.get(['cache', 'stats'], (v) =>
        resolve({ count: Object.keys(v.cache || {}).length, stats: v.stats || {}, first: v.cache?.['practice makes perfect'] || null })
      );
    })
);
check('记录已写入本地存储', storage.count >= 3, JSON.stringify(storage.stats) + ' entries=' + storage.count);
check('记录里保存了 token 明细', !!storage.first?.usage?.total && storage.first.usage.total > 0, JSON.stringify(storage.first?.usage || null));
check('默认关闭思考：输出 token 很小（不含推理）', storage.first?.usage?.output > 0 && storage.first.usage.output < 80, JSON.stringify(storage.first?.usage || null));
check('统计累计 token 与模型请求数', storage.stats.tokensTotal > 0 && storage.stats.tokenRequests >= 3, JSON.stringify(storage.stats));
check('缓存命中未重复计 token', storage.stats.tokensTotal < storage.stats.tokensIn * 3, JSON.stringify(storage.stats));
check('无页面级 JS 报错', pageErrors.length === 0, pageErrors.join(' | '));
check('无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

await patchConfig({ inPrice: 0, outPrice: 0 });

async function readToolbar() {
  return page.evaluate(() => {
    const host = document.getElementById('__hover_translate_toolbar__');
    const btn = host && host.shadowRoot && host.shadowRoot.querySelector('button.btn');
    const wrap = btn && btn.parentElement;
    if (!wrap || wrap.style.display === 'none') return { visible: false };
    return { visible: true, label: btn.textContent };
  });
}

async function waitForToolbar(timeout = 5000, interval = 150) {
  const deadline = Date.now() + timeout;
  let last = { visible: false };
  while (Date.now() < deadline) {
    last = await readToolbar();
    if (last.visible) return last;
    await sleep(interval);
  }
  return last;
}

await patchConfig({ autoTranslate: false });
await page.evaluate(() => window.getSelection().removeAllRanges());
await sleep(400);
await selectText('second', 0, 32);
const toolbarBefore = await waitForToolbar();
const cardBefore = await readCard();
check(
  '关闭「选中即翻译」后不自动弹卡片，只出浮动按钮',
  toolbarBefore.visible && toolbarBefore.label === '译' && !cardBefore,
  JSON.stringify({ toolbar: toolbarBefore, card: !!cardBefore })
);

await page.evaluate(() => {
  const host = [...document.querySelectorAll('div[id^="__hover_translate"]')].find(
    (h) => h.shadowRoot && h.shadowRoot.querySelector('button.btn')
  );
  host.shadowRoot.querySelector('button.btn').click();
});
const card4 = await waitForCard((c) => c.out && !c.loading, 20000, 200);
check('点浮动「译」按钮能翻译当前选区', !!card4 && card4.srcText.includes('rolling stone'), card4 ? card4.out.slice(0, 40) : 'no card');
check('恢复默认配置后仍可翻译', (await readConfig()).inPrice === 0, JSON.stringify(await readConfig()));

await patchConfig({ autoTranslate: true });
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
server.close();
process.exit(failed.length ? 1 : 0);