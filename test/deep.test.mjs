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

const deep = await import('../shared/deep.js');
const vocab = await import('../shared/vocab.js');
const deepcache = await import('../shared/deepcache.js');
const cache = await import('../shared/cache.js');

function fakeFetch(contents) {
  const calls = [];
  const queue = [...contents];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const content = queue.shift();
    return {
      ok: true,
      status: 200,
      json: async () => ({ model: 'm', choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
    };
  };
  fn.calls = calls;
  return fn;
}

const cfg = { baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'm', timeoutMs: 1000, level: 'cet6' };

test('splitSentences：常规分句，缩写/首字母/小写续写不误切', () => {
  assert.deepEqual(deep.splitSentences('Hello world. How are you? Fine!'), ['Hello world.', 'How are you?', 'Fine!']);
  assert.deepEqual(deep.splitSentences('Mr. Smith met Dr. Lee at 3 p.m. yesterday. They talked.'), [
    'Mr. Smith met Dr. Lee at 3 p.m. yesterday.',
    'They talked.'
  ]);
  assert.deepEqual(deep.splitSentences('J. K. Rowling wrote it. Good.'), ['J. K. Rowling wrote it.', 'Good.']);
  assert.deepEqual(deep.splitSentences('Prices rose 2.5 percent, e.g. in food.  Then\nfell.'), [
    'Prices rose 2.5 percent, e.g. in food.',
    'Then fell.'
  ]);
  assert.deepEqual(deep.splitSentences('   '), []);
});

test('parseJsonLoose：去 Markdown 围栏、截取首尾大括号、坏 JSON 返回 null', () => {
  assert.deepEqual(deep.parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(deep.parseJsonLoose('好的，结果如下：{"a":2} 希望有帮助'), { a: 2 });
  assert.equal(deep.parseJsonLoose('{"a":'), null);
  assert.equal(deep.parseJsonLoose(''), null);
});

test('normalizeAnalysis：过滤非法角色、空词，常见义与语境义相同时清空，难度夹到 1-5', () => {
  const out = deep.normalizeAnalysis({
    translation: ' 译文 ',
    spans: [{ text: 'Critics', role: 'Subject', note: '主语' }, { text: 'x', role: 'weird' }, { text: '', role: 'verb' }],
    howToRead: '主干是…',
    words: [{ word: 'reason', inContext: '推理', common: '原因' }, { word: 'argue', inContext: '认为', common: '认为' }, { word: '' }],
    phrases: [{ text: 'little more than', meaning: '不过是' }],
    grammar: ['宾语从句', ''],
    difficulty: 9
  });
  assert.equal(out.translation, '译文');
  assert.deepEqual(out.spans, [{ text: 'Critics', role: 'subject', note: '主语' }]);
  assert.equal(out.words.length, 2);
  assert.equal(out.words[0].common, '原因');
  assert.equal(out.words[1].common, '');
  assert.deepEqual(out.grammar, ['宾语从句']);
  assert.equal(out.difficulty, 5);
  assert.equal(deep.normalizeAnalysis(null).translation, '');
});

const flat = (nodes) => nodes.map((n) => (n.type === 'text' ? n.text : flat(n.children))).join('');
const roles = (nodes, acc = []) => {
  for (const n of nodes) if (n.type === 'span') acc.push(n.role), roles(n.children, acc);
  return acc;
};

test('segmentSentence：嵌套片段组装成树，拼回去与原句完全一致', () => {
  const s = 'What surprised researchers most was that the models, trained only to predict the next word, could reason.';
  const nodes = deep.segmentSentence(s, [
    { text: 'What surprised researchers most', role: 'clause' },
    { text: 'was', role: 'verb' },
    { text: 'that the models, trained only to predict the next word, could reason', role: 'clause' },
    { text: 'trained only to predict the next word', role: 'nonfinite' }
  ]);
  assert.equal(flat(nodes), s);
  assert.deepEqual(roles(nodes), ['clause', 'verb', 'clause', 'nonfinite']);
  const second = nodes.filter((n) => n.type === 'span')[2];
  assert.equal(second.children.filter((n) => n.type === 'span')[0].role, 'nonfinite');
});

test('segmentSentence：找不到的片段丢弃、交叉片段丢弃、大小写不敏感、重复词取不冲突的位置', () => {
  const s = 'The cat saw the dog.';
  const nodes = deep.segmentSentence(s, [
    { text: 'the cat', role: 'subject' },
    { text: 'not here', role: 'object' },
    { text: 'cat saw', role: 'verb' },
    { text: 'the dog', role: 'object' }
  ]);
  assert.equal(flat(nodes), s);
  assert.deepEqual(roles(nodes), ['subject', 'object']);
  const spans = nodes.filter((n) => n.type === 'span');
  assert.equal(flat(spans[1].children), 'the dog');

  const s2 = 'He said that it was the end that mattered.';
  const n2 = deep.segmentSentence(s2, [
    { text: 'that it was the end', role: 'clause' },
    { text: 'that', role: 'insert' }
  ]);
  assert.equal(flat(n2), s2);
  assert.deepEqual(roles(n2), ['clause', 'insert']);
});

test('checkDeepInput：超长、超句数给出错误', () => {
  assert.equal(deep.checkDeepInput('').ok, false);
  assert.equal(deep.checkDeepInput('a'.repeat(3001)).ok, false);
  const many = Array.from({ length: 13 }, (_, i) => `Sentence number ${i + 1}.`).join(' ');
  const r = deep.checkDeepInput(many);
  assert.equal(r.ok, false);
  assert.match(r.error, /12 句/);
  assert.equal(deep.checkDeepInput('One. Two.').sentences.length, 2);
});

test('analyzeSentence：请求带 json_object 与关思考，提示词含英语水平与上下文；坏 JSON 重试一次并累计 tokens', async () => {
  const good = JSON.stringify({ translation: '你好', spans: [], words: [], phrases: [], grammar: [], difficulty: 1 });
  const f = fakeFetch(['不是 JSON', good]);
  const out = await deep.analyzeSentence('Hello there.', { prev: 'Hi.', next: 'Bye.' }, cfg, f);
  assert.equal(out.data.translation, '你好');
  assert.equal(f.calls.length, 2);
  const body = f.calls[0].body;
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.reasoning_effort, 'none');
  assert.match(body.messages[0].content, /六级/);
  assert.match(body.messages[1].content, /前文.*Hi\./);
  assert.match(body.messages[1].content, /要分析的句子：Hello there\./);
  assert.equal(out.usage.total, 30);

  const bad = fakeFetch(['x', 'y']);
  await assert.rejects(() => deep.analyzeSentence('Hello.', {}, cfg, bad), /格式不对/);
});

test('lookupWord：返回语境义，缺 word 时用原词兜底', async () => {
  const f = fakeFetch([JSON.stringify({ ipa: '/x/', pos: 'v.', inContext: '推理', common: '原因' })]);
  const out = await deep.lookupWord('reason', 'They reason well.', cfg, f);
  assert.deepEqual(out.data, { word: 'reason', ipa: '/x/', pos: 'v.', inContext: '推理', common: '原因' });
});

test('schedule：不认识 10 分钟后重来；认识 1→3→8 天；模糊 ×1.2 至少 1 天；上限 180 天', () => {
  const now = 1_000_000;
  const DAY = vocab.DAY;
  let r = vocab.schedule(null, 'good', now);
  assert.equal(r.interval, 1);
  assert.equal(r.due, now + DAY);
  r = vocab.schedule(r, 'good', now);
  assert.equal(r.interval, 3);
  r = vocab.schedule(r, 'good', now);
  assert.equal(r.interval, 8);
  assert.equal(r.reps, 3);
  const hard = vocab.schedule(r, 'hard', now);
  assert.equal(hard.interval, 10);
  assert.equal(vocab.schedule(null, 'hard', now).interval, 1);
  const again = vocab.schedule(r, 'again', now);
  assert.equal(again.interval, 0);
  assert.equal(again.lapses, 1);
  assert.equal(again.due, now + 10 * 60 * 1000);
  assert.equal(vocab.schedule({ interval: 150, reps: 9, lapses: 0 }, 'good', now).interval, 180);
  assert.throws(() => vocab.schedule(null, 'nope', now));
  assert.equal(vocab.isMastered({ review: { interval: 21 } }), true);
});

test('markWord：命中常见屈折变化，未命中原样返回', () => {
  assert.deepEqual(vocab.markWord('They are reasoning about it.', 'reason'), [
    { text: 'They are ', hit: false },
    { text: 'reasoning', hit: true },
    { text: ' about it.', hit: false }
  ]);
  assert.equal(vocab.markWord('He is making tea.', 'make').find((p) => p.hit).text, 'making');
  assert.equal(vocab.markWord('It turned out fine.', 'turn out').find((p) => p.hit), undefined);
  assert.equal(vocab.markWord('It turned out fine.', 'turned out').find((p) => p.hit).text, 'turned out');
  assert.deepEqual(vocab.markWord('No match.', 'zebra'), [{ text: 'No match.', hit: false }]);
});

test('生词本：加入、重复加入保留进度并补字段、复习更新、删除', async () => {
  delete store.vocab;
  const a = await vocab.addWord({ word: ' Reason ', meaning: '推理', sentence: 'They reason well.' });
  assert.equal(a.key, 'reason');
  assert.equal(a.entry.review.interval, 0);
  await vocab.reviewWord('reason', 'good');
  const b = await vocab.addWord({ word: 'reason', ipa: '/ˈriːzn/', meaning: '另一个意思' });
  assert.equal(b.entry.review.interval, 1);
  assert.equal(b.entry.meaning, '推理');
  assert.equal(b.entry.ipa, '/ˈriːzn/');
  const all = await vocab.readVocab();
  assert.equal(vocab.dueQueue(all).length, 0);
  assert.equal(vocab.dueQueue(all, Date.now() + 2 * vocab.DAY).length, 1);
  await vocab.removeWord('REASON');
  assert.deepEqual(await vocab.readVocab(), {});
  assert.equal(await vocab.addWord({ word: '  ' }), null);
});

test('并发写生词本不丢数据（存储加锁）', async () => {
  delete store.vocab;
  await Promise.all(['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map((w) => vocab.addWord({ word: w })));
  assert.equal(Object.keys(await vocab.readVocab()).length, 5);
});

test('导出：CSV 带 BOM 与转义；Anki 两列制表符、加粗原句中的词', () => {
  const e = { word: 'reason', ipa: '/x/', pos: 'v.', meaning: '推理, 思考', common: '', sentence: 'They "reason" well.', ts: 0, review: { due: 0 } };
  const csv = vocab.toCsv([e]);
  assert.ok(csv.startsWith('﻿单词,'));
  assert.match(csv, /"推理, 思考"/);
  assert.match(csv, /"They ""reason"" well\."/);
  const tsv = vocab.toAnkiTsv([e]);
  const cols = tsv.split('\t');
  assert.equal(cols.length, 2);
  assert.match(cols[0], /<b>reason<\/b>/);
  assert.match(cols[0], /&quot;<b>reason<\/b>&quot;/);
  assert.match(cols[1], /推理, 思考/);
});

test('精读缓存：按 key 存取，换版本前缀的旧数据被清理，并发写入与统计不丢', async () => {
  delete store.deep;
  delete store.stats;
  const k = deepcache.deepKey('s', 'cet6', ' Hello   World. ');
  assert.equal(k, 'v1|s|cet6|hello world.');
  await deepcache.putDeep(k, { translation: '你好' }, 'm', null);
  assert.equal((await deepcache.getDeep(k)).data.translation, '你好');
  assert.equal(await deepcache.getDeep('v1|s|cet6|nope'), null);
  const d = { 'v0|s|x': { ts: Date.now() }, [k]: { ts: Date.now() } };
  deepcache.pruneDeep(d);
  assert.deepEqual(Object.keys(d), [k]);

  await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      Promise.all([deepcache.putDeep('v1|s|cet6|' + i, {}, 'm', null), cache.recordUsage({ prompt_tokens: 10, completion_tokens: 2 })])
    )
  );
  assert.equal(Object.keys(store.deep).length, 7);
  assert.equal(store.stats.misses, 6);
  assert.equal(store.stats.tokensIn, 60);
});

test('全文精读 prepareArticle：滤掉非英文块，段落分句并记下句子区间，丢掉末尾孤立小标题', () => {
  const article = deep.prepareArticle([
    { kind: 'h', text: 'Why  Models Reason' },
    { kind: 'p', text: 'The models were trained to predict the next word. They ended up doing much more.' },
    { kind: 'p', text: '这一段是中文评论，不应该被送去精读，即使它很长很长。' },
    { kind: 'p', text: 'Share' },
    { kind: 'p', text: 'Critics remain unconvinced by these claims.' },
    { kind: 'h', text: 'Related articles' }
  ]);
  assert.deepEqual(
    article.items.map((it) => [it.kind, it.src, it.from, it.to]),
    [
      ['h', 0, undefined, undefined],
      ['p', 1, 0, 2],
      ['p', 4, 2, 3]
    ]
  );
  assert.equal(article.items[0].text, 'Why Models Reason');
  assert.deepEqual(article.sentences, [
    'The models were trained to predict the next word.',
    'They ended up doing much more.',
    'Critics remain unconvinced by these claims.'
  ]);
  assert.equal(article.truncated, false);
  assert.equal(deep.checkArticle(article).ok, false, '正文太短不算文章');
  const long = deep.prepareArticle(
    Array.from({ length: 4 }, (_, i) => ({ kind: 'p', text: `Paragraph ${i} explains one more idea in plain words. It then adds a short example.` }))
  );
  assert.equal(deep.checkArticle(long).ok, true);
});

test('全文精读 prepareArticle：超过句数上限时截断并标记', () => {
  const blocks = Array.from({ length: deep.ARTICLE_MAX_SENTENCES / 2 + 5 }, (_, i) => ({
    kind: 'p',
    text: `Sentence number ${i} is here. Another one follows it.`
  }));
  const article = deep.prepareArticle(blocks);
  assert.equal(article.truncated, true);
  assert.equal(article.sentences.length, deep.ARTICLE_MAX_SENTENCES);
});

test('isEnglishText：按拉丁字母占比和词数判断', () => {
  assert.equal(deep.isEnglishText('Practice makes perfect.', 3), true);
  assert.equal(deep.isEnglishText('Practice', 3), false);
  assert.equal(deep.isEnglishText('大模型 LLM 的推理能力', 1), false);
  assert.equal(deep.isEnglishText('2024-01-02 12:30 · 1,024', 1), false);
  assert.equal(deep.isEnglishText('', 1), false);
});

test('导读：段落编号、长文按段截断；结构里的段落号夹到有效范围；长文本缓存键是定长摘要', async () => {
  const items = [
    { kind: 'h', text: 'Intro' },
    { kind: 'p', text: 'First paragraph here.' },
    { kind: 'p', text: 'Second paragraph here.' }
  ];
  assert.equal(deep.outlineInput(items), '## Intro\n[1] First paragraph here.\n[2] Second paragraph here.');
  const many = Array.from({ length: 200 }, () => ({ kind: 'p', text: 'word '.repeat(200) }));
  const input = deep.outlineInput(many);
  assert.ok(input.length <= deep.OUTLINE_MAX_CHARS);
  assert.ok(input.includes('[100] '), '每段只留开头，后面的段落也要覆盖到');

  const fetchImpl = fakeFetch([
    JSON.stringify({
      gist: '全文主旨',
      sections: [
        { title: '开头', from: 1, to: 1, summary: '引入' },
        { title: '越界', from: 2, to: 9, summary: '' },
        { title: '', summary: '', from: 1, to: 1 },
        { title: '没有段落号' }
      ],
      points: ['注意让步', '', '对比论证']
    })
  ]);
  const out = await deep.analyzeOutline('Title', items, cfg, fetchImpl);
  assert.equal(out.data.gist, '全文主旨');
  assert.deepEqual(out.data.sections, [
    { title: '开头', summary: '引入', from: 1, to: 1 },
    { title: '越界', summary: '', from: 2, to: 2 }
  ]);
  assert.deepEqual(out.data.points, ['注意让步', '对比论证']);
  const user = fetchImpl.calls[0].body.messages[1].content;
  assert.ok(user.startsWith('标题：Title\n\n## Intro\n[1] '));
  assert.equal(fetchImpl.calls[0].body.response_format.type, 'json_object');

  assert.equal(deep.textDigest('abc'), deep.textDigest('abc'));
  assert.notEqual(deep.textDigest('abc'), deep.textDigest('abd'));
  assert.ok(deep.textDigest('x'.repeat(20000)).length < 40);
});

test('精读记录：同一网址只留一条并保留进度，内容变了进度清零，进度只增不减，超量按最近阅读淘汰', async () => {
  const readings = await import('../shared/readings.js');
  await readings.clearReadings();
  const doc = (url, n = 3) => ({
    mode: 'article',
    title: 'T',
    url,
    items: [{ kind: 'p', text: 'x', from: 0, to: n }],
    sentences: Array.from({ length: n }, (_, i) => `Sentence ${i}.`),
    active: 0
  });
  assert.equal(await readings.saveReading({ mode: 'article', sentences: [] }), null);
  assert.equal(await readings.saveReading({ mode: 'selection', text: '' }), null);

  const first = await readings.saveReading(doc('https://a.example/post'), 1000);
  assert.equal(first.id, readings.readingId(doc('https://a.example/post')));
  assert.equal('active' in first.doc, false, '阅读位置存在记录上，不混进文章内容');
  await readings.updateReading(first.id, { active: 0, read: 2 }, 2000);
  await readings.updateReading(first.id, { read: 1 }, 2500);
  const again = await readings.saveReading({ ...doc('https://a.example/post'), active: -1 }, 3000);
  assert.deepEqual([again.ts, again.lastOpen, again.read, again.active], [1000, 3000, 2, 0]);
  const changed = await readings.saveReading(doc('https://a.example/post', 5), 4000);
  assert.equal(changed.read, 0);
  assert.equal(Object.keys(await readings.readReadings()).length, 1);

  const sel = await readings.saveReading({ mode: 'selection', text: 'A rolling  stone gathers no moss.', url: 'https://a.example/' }, 4500);
  assert.equal(sel.id, readings.readingId({ mode: 'selection', text: 'a rolling stone gathers no moss.' }));

  for (let i = 0; i < readings.READINGS_MAX + 3; i++) await readings.saveReading(doc(`https://b.example/${i}`), 5000 + i);
  const list = readings.listReadings(await readings.readReadings());
  assert.equal(list.length, readings.READINGS_MAX);
  assert.equal(list[0].doc.url, `https://b.example/${readings.READINGS_MAX + 2}`);
  assert.ok(!list.some((e) => e.id === first.id), '最久没读的被淘汰');
  await readings.removeReading(list[0].id);
  assert.equal(Object.keys(await readings.readReadings()).length, readings.READINGS_MAX - 1);
});
