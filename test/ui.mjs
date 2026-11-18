import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '..');
const EXE =
  process.env.CHROME_EXE ||
  process.env.HOME + '/.cache/puppeteer/chrome/mac_arm-148.0.7778.97/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: EXE,
  headless: false,
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1000,900',
    '--window-position=-2400,-1400',
    '--no-first-run',
    '--no-default-browser-check',
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`
  ]
});

let extensionId = null;
for (let i = 0; i < 40 && !extensionId; i++) {
  const t = browser.targets().find((x) => x.url().startsWith('chrome-extension://'));
  if (t) extensionId = new URL(t.url()).host;
  else await sleep(250);
}
check('扩展加载', !!extensionId, extensionId || 'not loaded');

async function openPage(relative, name) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${extensionId}/${relative}`, { waitUntil: 'load' });
  await sleep(700);
  return { page, errors, name };
}

const options = await openPage('options/options.html', 'options');
const optionState = await options.page.evaluate(() => ({
  model: document.getElementById('model').value,
  baseUrl: document.getElementById('baseUrl').value,
  keyLen: document.getElementById('apiKey').value.length,
  auto: document.getElementById('autoTranslate').checked,
  presets: document.getElementById('models').options.length
}));
check('设置页渲染默认配置', optionState.model === 'deepseek-v4.1-flash' && optionState.keyLen > 0 && optionState.auto, JSON.stringify(optionState));
check('设置页无 JS 报错', options.errors.length === 0, options.errors.join(' | '));

const extraSections = await options.page.evaluate(() => ({
  autoSpeak: !!document.getElementById('autoSpeak'),
  rate: !!document.getElementById('speakRate'),
  voiceOptions: document.getElementById('speakVoice').options.length,
  firstVoiceLabel: document.getElementById('speakVoice').options[0].textContent,
  inPrice: !!document.getElementById('inPrice'),
  outPrice: !!document.getElementById('outPrice'),
  headings: [...document.querySelectorAll('h2')].map((h) => h.textContent)
}));
check(
  '设置页有朗读与费用配置',
  extraSections.autoSpeak && extraSections.rate && extraSections.inPrice && extraSections.outPrice &&
    extraSections.headings.includes('朗读') && extraSections.headings.includes('费用') &&
    extraSections.firstVoiceLabel.includes('自动'),
  JSON.stringify(extraSections)
);

await options.page.click('#test');
let testText = '';
for (let i = 0; i < 60; i++) {
  testText = await options.page.$eval('#testResult', (n) => n.textContent);
  if (testText && !testText.includes('测试中')) break;
  await sleep(500);
}
check('设置页「测试连接」成功', testText.startsWith('成功'), testText.slice(0, 60));

await options.page.click('#save');
await sleep(400);
check('设置页保存成功', (await options.page.$eval('#saved', (n) => n.textContent)).includes('已保存'));
const persisted = await options.page.evaluate(() => new Promise((r) => chrome.storage.local.get('config', (v) => r(v.config || {}))));
check('配置写入 storage', persisted.model === 'deepseek-v4.1-flash', JSON.stringify(persisted).slice(0, 90));

const popup = await openPage('popup/popup.html', 'popup');
const popupState = await popup.page.evaluate(() => ({
  model: document.getElementById('model').textContent,
  auto: document.getElementById('autoTranslate').checked,
  stats: document.getElementById('stats').textContent.replace(/\s+/g, ' ').trim(),
  hintVisible: !document.getElementById('priceHint').hidden,
  autoSpeakToggle: !!document.getElementById('autoSpeak')
}));
check('弹窗显示当前模型', popupState.model === 'deepseek-v4.1-flash', popupState.model);
check('弹窗显示统计', /记录条数/.test(popupState.stats) && /缓存命中/.test(popupState.stats), popupState.stats);
check('弹窗显示 token 与费用统计', /输入 tokens/.test(popupState.stats) && /输出 tokens/.test(popupState.stats) && /预估费用/.test(popupState.stats), popupState.stats);
check('未配单价时弹窗提示填单价', popupState.hintVisible && popupState.stats.includes('—预估费用'), popupState.stats);
check('弹窗有自动朗读开关', popupState.autoSpeakToggle);
check('弹窗无 JS 报错', popup.errors.length === 0, popup.errors.join(' | '));

const history = await openPage('history/history.html', 'history');
const historyState = await history.page.evaluate(() => ({
  rows: document.querySelectorAll('#rows tr').length,
  emptyHidden: document.getElementById('empty').hidden,
  tokenHeader: [...document.querySelectorAll('th')].some((th) => th.textContent.trim() === 'tokens'),
  summary: document.getElementById('summary').textContent.replace(/\s+/g, ' ').trim()
}));
check('记录页可打开且表格可渲染', historyState.rows >= 0 && typeof historyState.emptyHidden === 'boolean', JSON.stringify(historyState));
check('记录页有 tokens 表头与汇总栏', historyState.tokenHeader && /累计 tokens/.test(historyState.summary), JSON.stringify(historyState));
check('记录页无 JS 报错', history.errors.length === 0, history.errors.join(' | '));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);