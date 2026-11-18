import test from 'node:test';
import assert from 'node:assert/strict';

const store = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of list) if (k in store) out[k] = structuredClone(store[k]);
        return out;
      },
      async set(obj) {
        for (const [k, v] of Object.entries(obj)) store[k] = structuredClone(v);
      }
    }
  }
};

const cache = await import('../shared/cache.js');
const model = await import('../shared/model.js');
const usage = await import('../shared/usage.js');
const speech = await import('../shared/speech.js');

const cfg = { baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'm', timeoutMs: 1000 };

function fakeFetch(payload, ok = true, status = 200) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return { ok, status, json: async () => payload };
  };
  fn.calls = calls;
  return fn;
}

test('normKey collapses whitespace, case and edge blanks', () => {
  assert.equal(cache.normKey('  The   Quick\nbrown '), 'the quick brown');
  assert.equal(cache.normKey(''), '');
});

test('缓存命中：相同文本第二次直接取记录，不再请求模型', async () => {
  const fetchImpl = fakeFetch({ model: 'm', choices: [{ message: { content: '敏捷的棕色狐狸' } }] });
  const first = await model.translateText('The Quick Brown Fox', cfg, fetchImpl);
  await cache.putEntry('The Quick Brown Fox', first.translation, first.model, 'model');

  const hit = await cache.getEntry('  the  quick brown   fox ');
  assert.equal(hit.translation, '敏捷的棕色狐狸');
  assert.equal(fetchImpl.calls.length, 1);

  const second = await cache.getEntry('THE QUICK BROWN FOX');
  assert.equal(second.translation, '敏捷的棕色狐狸');
  assert.equal(fetchImpl.calls.length, 1);
});

test('未命中返回 null', async () => {
  assert.equal(await cache.getEntry('never seen before'), null);
});

test('过期记录不再命中', async () => {
  await cache.putEntry('stale entry', '旧译文', 'm', 'model');
  const { cache: raw } = await cache.readCache();
  raw['stale entry'].ts = Date.now() - cache.KEEP_MS - 1000;
  await chrome.storage.local.set({ cache: raw });
  assert.equal(await cache.getEntry('stale entry'), null);
});

test('translateText 请求体与解析：清洗"译文："前缀与 ** 包裹', async () => {
  const fetchImpl = fakeFetch({ model: 'm', choices: [{ message: { content: '译文：**敏捷的狐狸**' } }] });
  const out = await model.translateText('The fox', cfg, fetchImpl);
  assert.equal(out.translation, '敏捷的狐狸');
  const body = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(fetchImpl.calls[0].url, 'https://api.example.com/v1/chat/completions');
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer k');
  assert.equal(body.model, 'm');
  assert.equal(body.messages.length, 2);
  assert.match(body.messages[1].content, /The fox/);
});

test('translateText：默认关闭思考（reasoning_effort=none），打开思考时不带该参数', async () => {
  const off = fakeFetch({ choices: [{ message: { content: '熟能生巧。' } }] });
  await model.translateText('Practice makes perfect.', cfg, off);
  const offBody = JSON.parse(off.calls[0].init.body);
  assert.equal(offBody.reasoning_effort, 'none');

  const on = fakeFetch({ choices: [{ message: { content: '熟能生巧。' } }] });
  await model.translateText('Practice makes perfect.', { ...cfg, thinking: true }, on);
  const onBody = JSON.parse(on.calls[0].init.body);
  assert.equal('reasoning_effort' in onBody, false);
});

test('translateText 透传接口错误信息', async () => {
  const fetchImpl = fakeFetch({ error: { message: 'model_not_found' } }, false, 404);
  await assert.rejects(() => model.translateText('x', cfg, fetchImpl), /model_not_found/);
});

test('translateText 空译文报错，baseUrl 已含路径时不重复拼接', async () => {
  const empty = fakeFetch({ choices: [{ message: { content: '' } }] });
  await assert.rejects(() => model.translateText('x', cfg, empty), /没有返回译文/);
  const full = fakeFetch({ choices: [{ message: { content: '好' } }] });
  await model.translateText('x', { ...cfg, baseUrl: 'https://api.example.com/v1/chat/completions/' }, full);
  assert.equal(full.calls[0].url, 'https://api.example.com/v1/chat/completions');
});

test('history 列表按最近使用排序，删除与清空生效', async () => {
  await cache.clearCache();
  await cache.putEntry('one', '一', 'm', 'model');
  await cache.putEntry('two', '二', 'm', 'model');
  await cache.getEntry('one');
  const { cache: raw } = await cache.readCache();
  const list = cache.listEntries(raw);
  assert.equal(list[0].text, 'one');
  assert.equal(list.length, 2);

  await cache.removeEntry(cache.normKey('one'));
  assert.equal((await cache.readCache()).cache.one, undefined);

  await cache.clearCache();
  assert.deepEqual((await cache.readCache()).cache, {});
});

test('统计：模型请求计 misses，缓存命中计 hits', async () => {
  await cache.clearCache();
  await cache.putEntry('stat probe', '统计探针', 'm', 'model');
  assert.equal((await cache.readCache()).stats.misses, 1);

  await cache.getEntry('stat probe');
  await cache.getEntry('stat probe');
  assert.equal((await cache.readCache()).stats.hits, 2);
  assert.equal((await cache.getEntry('stat probe')).hits, 3);
});


test('normalizeUsage：解析用量与缓存/推理明细', () => {
  const u = usage.normalizeUsage({
    prompt_tokens: 46,
    completion_tokens: 153,
    total_tokens: 199,
    prompt_tokens_details: { cached_tokens: 12 },
    completion_tokens_details: { reasoning_tokens: 147 }
  });
  assert.deepEqual(u, { input: 46, output: 153, total: 199, cachedInput: 12, reasoning: 147 });
  assert.equal(usage.normalizeUsage({ prompt_tokens: 0, completion_tokens: 0 }), null);
  assert.equal(usage.normalizeUsage(null), null);
  assert.equal(usage.normalizeUsage({}), null);
  assert.equal(usage.normalizeUsage({ foo: 'bar' }), null);
  const inputOnly = usage.normalizeUsage({ prompt_tokens: 10 });
  assert.deepEqual(inputOnly, { input: 10, output: 0, total: 10, cachedInput: 0, reasoning: 0 });
  const noTotal = usage.normalizeUsage({ prompt_tokens: 10, completion_tokens: 5 });
  assert.equal(noTotal.total, 15);
  assert.equal(noTotal.reasoning, 0);
});

test('normalizeUsage 幂等：已归一化的对象再归一化不变（否则写入存储时会丢用量）', () => {
  const raw = {
    prompt_tokens: 46,
    completion_tokens: 153,
    total_tokens: 199,
    prompt_tokens_details: { cached_tokens: 12 },
    completion_tokens_details: { reasoning_tokens: 147 }
  };
  const once = usage.normalizeUsage(raw);
  assert.deepEqual(usage.normalizeUsage(once), once);
  assert.equal(usage.formatUsage(once), 'tokens 199（入 46 / 出 153）');
  assert.equal(usage.estimateCost(once, { inPrice: 2, outPrice: 8 }), (46 / 1e6) * 2 + (153 / 1e6) * 8);
  assert.equal(usage.estimateCost({ prompt_tokens: 500000, completion_tokens: 0 }, { inPrice: 2 }), 1);
});

test('estimateCost：只认已归一化用量，空用量返回 null', () => {
  assert.equal(usage.estimateCost(null, { inPrice: 1 }), null);
  assert.equal(usage.estimateCost({}, { inPrice: 1 }), null);
});

test('addUsage：累计到统计并自增请求数，无效用量不动统计', () => {
  const stats = { ...cache.EMPTY_STATS };
  usage.addUsage(stats, { prompt_tokens: 46, completion_tokens: 153, total_tokens: 199 });
  usage.addUsage(stats, { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 });
  usage.addUsage(stats, null);
  assert.equal(stats.tokensIn, 50);
  assert.equal(stats.tokensOut, 159);
  assert.equal(stats.tokensTotal, 209);
  assert.equal(stats.tokenRequests, 2);
});

test('estimateCost：未填单价返回 null，填了按百万 tokens 计费', () => {
  const tokens = { tokensIn: 1_000_000, tokensOut: 500_000 };
  assert.equal(usage.estimateCost(tokens, {}), null);
  assert.equal(usage.estimateCost(tokens, { inPrice: 0, outPrice: 0 }), null);
  assert.equal(usage.estimateCost(tokens, { inPrice: 2, outPrice: 8 }), 6);
  assert.equal(usage.estimateCost({ input: 500_000, output: 0 }, { inPrice: 2 }), 1);
});

test('formatUsage / formatCost：展示文案', () => {
  assert.equal(usage.formatUsage({ prompt_tokens: 1234, completion_tokens: 66, total_tokens: 1300 }), 'tokens 1,300（入 1,234 / 出 66）');
  assert.equal(usage.formatUsage(null), '');
  assert.equal(usage.formatCost(0), '¥0');
  assert.equal(usage.formatCost(0.000123), '¥0.0001');
  assert.equal(usage.formatCost(0.1234), '¥0.12');
  assert.equal(usage.formatCost(null), '');
});

test('putEntry 带 usage：记录里存 tokens，统计只由模型请求累计', async () => {
  await cache.clearCache();
  await cache.putEntry('uprobe', '探针', 'm', 'model', {
    prompt_tokens: 100,
    completion_tokens: 20,
    total_tokens: 120
  });
  const { cache: raw, stats } = await cache.readCache();
  assert.equal(raw['uprobe'].usage.total, 120);
  assert.equal(stats.tokensIn, 100);
  assert.equal(stats.tokensOut, 20);
  assert.equal(stats.tokenRequests, 1);

  await cache.getEntry('uprobe');
  await cache.getEntry('uprobe');
  const after = await cache.readCache();
  assert.equal(after.stats.hits, 2);
  assert.equal(after.stats.tokensTotal, 120, '缓存命中不应重复计 token');

  await cache.putEntry('nostat', '缓存写入', 'm', 'cache');
  assert.equal((await cache.readCache()).stats.tokenRequests, 1);
  await cache.clearCache();
  assert.deepEqual((await cache.readCache()).stats, cache.EMPTY_STATS);
});

test('clampSpeakText：折叠空白、超长截断', () => {
  assert.equal(speech.clampSpeakText('  Hello\n\nworld  '), 'Hello world');
  assert.equal(speech.clampSpeakText(''), '');
  assert.equal(speech.clampSpeakText('ab', 1), 'a…');
  assert.equal(speech.clampSpeakText('x'.repeat(400)).length, speech.SPEAK_MAX_CHARS + 1);
});

test('pickVoice：指定音色优先，其次英文，最后本地音色', () => {
  const voices = [
    { name: 'Ting-Ting', lang: 'zh-CN', localService: true },
    { name: 'Samantha', lang: 'en-US', localService: false },
    { name: 'Daniel', lang: 'en-GB', localService: true },
    { name: 'Alice', lang: 'it-IT', localService: true }
  ];
  assert.equal(speech.pickVoice(voices, 'Alice').name, 'Alice');
  assert.equal(speech.pickVoice(voices, '不存在').name, 'Daniel');
  assert.equal(speech.pickVoice([{ name: 'Ting-Ting', lang: 'zh-CN', localService: true }], '').name, 'Ting-Ting');
  assert.equal(speech.pickVoice([], 'x'), null);
  assert.equal(speech.pickVoice(null, 'x'), null);
});
test('splitExample：拆出例句与例译，整句无例句时为 null', async () => {
  const model = await import('../shared/model.js');
  const out = model.splitExample('n. 影响 / 影响力；v. 影响\n例句：Her advice had a big influence on me.\n例译：她的建议对我影响很大。');
  assert.equal(out.translation, 'n. 影响 / 影响力；v. 影响');
  assert.deepEqual(out.example, { en: 'Her advice had a big influence on me.', zh: '她的建议对我影响很大。' });
  const plain = model.splitExample('敏捷的棕色狐狸跳过了那只懒狗。');
  assert.equal(plain.translation, '敏捷的棕色狐狸跳过了那只懒狗。');
  assert.equal(plain.example, null);
});

test('clean：去掉模型自带的类别名前缀', async () => {
  const model = await import('../shared/model.js');
  assert.equal(model.splitExample('固定短语/习语：滚石不生苔').translation, '滚石不生苔');
  assert.equal(model.splitExample('谚语：滚石不生苔，转业不聚财。').translation, '滚石不生苔，转业不聚财。');
  assert.equal(model.splitExample('【短语】滚石不生苔').translation, '滚石不生苔');
});

test('sumUsage：两次请求的 token 相加，单边为空时返回另一边', async () => {
  const usage = await import('../shared/usage.js');
  const a = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
  const b = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 };
  assert.deepEqual(usage.sumUsage(a, b), { input: 220, output: 40, total: 260, cachedInput: 0, reasoning: 0 });
  assert.deepEqual(usage.sumUsage(null, b), usage.normalizeUsage(b));
});
