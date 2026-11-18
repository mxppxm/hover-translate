import { chat } from './model.js';
import { sumUsage } from './usage.js';

// 精读：分句、提示词、JSON 容错解析、句子成分定位（纯函数部分可在 node 下单测）

export const DEEP_VERSION = 1;
export const DEEP_MAX_SENTENCES = 12;
export const DEEP_MAX_CHARS = 3000;

export const LEVELS = {
  cet4: '大学英语四级',
  cet6: '大学英语六级',
  kaoyan: '考研英语',
  ielts: '雅思/托福',
  all: ''
};

export const ROLES = {
  subject: '主语',
  verb: '谓语',
  object: '宾语/表语',
  clause: '从句',
  nonfinite: '非谓语',
  insert: '插入语'
};

const ABBR = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|No|Fig|Vol|Inc|Ltd|Co|Corp|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|e\.g|i\.e|U\.S|U\.K|a\.m|p\.m)|\b[A-Z])\.\s*$/;

export function splitSentences(text) {
  const src = String(text || '').replace(/\s+/g, ' ').trim();
  if (!src) return [];
  let parts;
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter('en', { granularity: 'sentence' });
    parts = [...seg.segment(src)].map((s) => s.segment);
  } else {
    parts = src.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [src];
  }
  const out = [];
  for (const raw of parts) {
    const piece = raw.trim();
    if (!piece) continue;
    const prev = out[out.length - 1];
    // 缩写、姓名首字母后的误切，或下一段以小写/数字开头，都并回上一句
    if (prev && (ABBR.test(prev) || /^[a-z0-9]/.test(piece))) {
      out[out.length - 1] = prev + ' ' + piece;
    } else {
      out.push(piece);
    }
  }
  return out;
}

export function parseJsonLoose(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : null;
  } catch (_) {}
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      const v = JSON.parse(s.slice(a, b + 1));
      return v && typeof v === 'object' ? v : null;
    } catch (_) {}
  }
  return null;
}

const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const arr = (v) => (Array.isArray(v) ? v : []);

export function normalizeWord(w) {
  if (!w || typeof w !== 'object') return null;
  const word = str(w.word);
  if (!word) return null;
  const common = str(w.common);
  const inContext = str(w.inContext || w.meaning);
  return {
    word,
    ipa: str(w.ipa),
    pos: str(w.pos),
    inContext,
    common: common && common !== inContext ? common : ''
  };
}

export function normalizeAnalysis(obj) {
  const o = obj && typeof obj === 'object' ? obj : {};
  const spans = arr(o.spans || o.structure?.spans)
    .map((s) => ({ text: str(s?.text), role: str(s?.role).toLowerCase(), note: str(s?.note) }))
    .filter((s) => s.text && ROLES[s.role]);
  const words = arr(o.words).map(normalizeWord).filter(Boolean).slice(0, 8);
  const phrases = arr(o.phrases)
    .map((p) => ({ text: str(p?.text), meaning: str(p?.meaning) }))
    .filter((p) => p.text)
    .slice(0, 6);
  const grammar = arr(o.grammar).map(str).filter(Boolean).slice(0, 4);
  const d = Math.round(Number(o.difficulty));
  return {
    translation: str(o.translation),
    spans,
    howToRead: str(o.howToRead || o.structure?.howToRead),
    words,
    phrases,
    grammar,
    difficulty: Number.isFinite(d) ? Math.min(5, Math.max(1, d)) : 0
  };
}

export function normalizeGist(obj) {
  const o = obj && typeof obj === 'object' ? obj : {};
  return { gist: str(o.gist), flow: arr(o.flow).map(str).filter(Boolean).slice(0, 8) };
}

function crosses(r, start, end) {
  return (start < r.start && end > r.start && end < r.end) || (start > r.start && start < r.end && end > r.end);
}

function locate(sentence, text, from = 0) {
  let i = sentence.indexOf(text, from);
  if (i >= 0) return i;
  i = sentence.toLowerCase().indexOf(text.toLowerCase(), from);
  return i;
}

// 把模型给的成分片段（原文子串）定位回句子，组装成可嵌套的片段树；
// 找不到的片段丢弃，与已有片段交叉的也丢弃（只保留能正确嵌套的）。
export function segmentSentence(sentence, spans) {
  const ranges = [];
  for (const s of arr(spans)) {
    const text = str(s?.text);
    if (!text) continue;
    // 同一片段在句中出现多次时，取第一个不与已有片段重复/交叉的位置
    let start = locate(sentence, text);
    let end = start + text.length;
    while (start >= 0 && ranges.some((r) => (r.start === start && r.end === end) || crosses(r, start, end))) {
      start = locate(sentence, text, start + 1);
      end = start + text.length;
    }
    if (start < 0) continue;
    ranges.push({ start, end, role: s.role, note: str(s.note), children: [] });
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const root = { start: 0, end: sentence.length, children: [] };
  const stack = [root];
  for (const r of ranges) {
    while (stack.length > 1 && stack[stack.length - 1].end <= r.start) stack.pop();
    const parent = stack[stack.length - 1];
    if (r.end > parent.end) continue; // 与父片段交叉
    parent.children.push(r);
    stack.push(r);
  }
  const build = (node) => {
    const out = [];
    let pos = node.start;
    for (const c of node.children) {
      if (c.start > pos) out.push({ type: 'text', text: sentence.slice(pos, c.start) });
      out.push({ type: 'span', role: c.role, note: c.note, children: build(c) });
      pos = c.end;
    }
    if (pos < node.end) out.push({ type: 'text', text: sentence.slice(pos, node.end) });
    return out;
  };
  return build(root);
}

function levelHint(level) {
  const name = LEVELS[level];
  return name ? `只挑超出${name}水平的词` : '只挑真正生僻的词';
}

export function sentencePrompt(level) {
  return [
    '你是英语精读老师，帮中文母语的学习者读懂英文句子。只输出一个 JSON 对象，不要 Markdown，不要多余文字。',
    '字段：',
    '- translation：自然流畅的中文译文',
    '- spans：句子成分标注数组，每项 {"text": 必须是原句中原样连续出现的片段, "role": 取值 subject(主语) / verb(谓语) / object(宾语或表语) / clause(从句) / nonfinite(非谓语：不定式、分词、动名词短语) / insert(插入语), "note": 不超过 15 字的中文说明}。先标主句主干（主语、谓语、宾语/表语），再标从句和非谓语；从句内部可以再标。片段可以嵌套，但不能交叉。简单句只标主干。',
    '- howToRead：一到两句中文，说明主干是什么、各修饰成分修饰谁',
    `- words：重点词数组，${levelHint(level)}，以及本句里用法特殊的常见词（熟词僻义、一词多义），最多 6 个，没有就给空数组。每项 {"word": 词典原形, "ipa": 美式音标, "pos": 词性缩写如 n. v. adj. adv. prep. phr., "inContext": 本句中的中文意思, "common": 与本句不同的常见意思，相同就给空字符串}`,
    '- phrases：值得积累的搭配或地道表达，每项 {"text": 英文, "meaning": 中文}，最多 4 个，没有就给空数组',
    '- grammar：语法难点，中文字符串数组，最多 3 条，没有就给空数组',
    '- difficulty：1 到 5 的整数，句子阅读难度'
  ].join('\n');
}

export function sentenceUserContent(sentence, prev, next) {
  const lines = [];
  if (prev) lines.push('前文（仅供理解语境，不要分析）：' + prev);
  if (next) lines.push('后文（仅供理解语境，不要分析）：' + next);
  lines.push('要分析的句子：' + sentence);
  return lines.join('\n');
}

export const GIST_PROMPT = [
  '你是英语精读老师。下面是一段英文，按句编号。只输出一个 JSON 对象，不要 Markdown。',
  '字段：',
  '- gist：一句中文，概括这段的主旨',
  '- flow：句间逻辑数组，每项形如 "1→2：转折，前面说……后面说……"，只写有意义的衔接，最多 6 条'
].join('\n');

export const WORD_PROMPT = [
  '你是英语词典。根据给出的句子，解释其中一个词在这句里的意思。只输出一个 JSON 对象，不要 Markdown。',
  '字段：word(词典原形), ipa(美式音标), pos(词性缩写如 n. v. adj. adv. prep. phr.), inContext(本句中的中文意思), common(与本句不同的常见意思，相同就给空字符串)'
].join('\n');

async function askJson(messages, cfg, maxTokens, fetchImpl) {
  let usage = null;
  let model = cfg.model;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await chat(messages, cfg, { json: true, maxTokens, timeoutMs: Math.max(cfg.timeoutMs || 30000, 45000) }, fetchImpl);
    usage = sumUsage(usage, out.usage);
    model = out.model;
    const obj = parseJsonLoose(out.content);
    if (obj) return { obj, usage, model };
  }
  const err = new Error('模型返回格式不对，请重试');
  err.usage = usage;
  throw err;
}

export async function analyzeSentence(sentence, ctx, cfg, fetchImpl) {
  const messages = [
    { role: 'system', content: sentencePrompt(cfg.level || 'cet6') },
    { role: 'user', content: sentenceUserContent(sentence, ctx?.prev, ctx?.next) }
  ];
  const { obj, usage, model } = await askJson(messages, cfg, 1600, fetchImpl);
  const data = normalizeAnalysis(obj);
  if (!data.translation) throw new Error('模型没有返回译文');
  return { data, usage, model };
}

export async function analyzeGist(sentences, cfg, fetchImpl) {
  const body = sentences.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const messages = [
    { role: 'system', content: GIST_PROMPT },
    { role: 'user', content: body }
  ];
  const { obj, usage, model } = await askJson(messages, cfg, 600, fetchImpl);
  return { data: normalizeGist(obj), usage, model };
}

export async function lookupWord(word, sentence, cfg, fetchImpl) {
  const messages = [
    { role: 'system', content: WORD_PROMPT },
    { role: 'user', content: `句子：${sentence}\n要解释的词：${word}` }
  ];
  const { obj, usage, model } = await askJson(messages, cfg, 300, fetchImpl);
  const data = normalizeWord({ word, ...obj, word: str(obj.word) || word });
  if (!data || !data.inContext) throw new Error('模型没有返回释义');
  return { data, usage, model };
}

export function checkDeepInput(text) {
  const src = String(text || '').replace(/\s+/g, ' ').trim();
  if (!src) return { ok: false, error: '没有选中文本' };
  if (src.length > DEEP_MAX_CHARS) return { ok: false, error: `内容过长（${src.length} 字符，上限 ${DEEP_MAX_CHARS}），请分段精读` };
  const sentences = splitSentences(src);
  if (sentences.length > DEEP_MAX_SENTENCES) {
    return { ok: false, error: `一次最多精读 ${DEEP_MAX_SENTENCES} 句（当前 ${sentences.length} 句），请分段精读` };
  }
  return { ok: true, text: src, sentences };
}

// ---- 全文精读 ----

export const ARTICLE_MAX_SENTENCES = 800;
export const OUTLINE_MAX_CHARS = 14000;

const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// 是否像一段英文：拉丁字母占非空白字符的多数，且至少有 minWords 个词
export function isEnglishText(text, minWords = 1) {
  const src = squash(text);
  if (!src) return false;
  const letters = (src.match(/[A-Za-z]/g) || []).length;
  const solid = src.replace(/\s/g, '').length;
  if (letters / solid < 0.6) return false;
  return (src.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length >= minWords;
}

// 把页面取出的块（{kind: 'h' | 'p', text}）整理成文章：滤掉非英文块，段落分句。
// 返回 items（h: {kind, src, text}；p: 另带 from / to，指向 sentences 的半开区间）和拍平的 sentences。
export function prepareArticle(blocks) {
  const items = [];
  const sentences = [];
  let truncated = false;
  arr(blocks).forEach((b, src) => {
    if (truncated) return;
    const text = squash(b?.text);
    if (b?.kind === 'h') {
      if (isEnglishText(text)) items.push({ kind: 'h', src, text });
      return;
    }
    if (!isEnglishText(text, 4)) return;
    const parts = splitSentences(text);
    if (sentences.length + parts.length > ARTICLE_MAX_SENTENCES) {
      truncated = true;
      return;
    }
    items.push({ kind: 'p', src, text, from: sentences.length, to: sentences.length + parts.length });
    sentences.push(...parts);
  });
  // 后面没有正文的小标题没有意义
  while (items.length && items[items.length - 1].kind === 'h') items.pop();
  return { items, sentences, truncated };
}

export function checkArticle(article) {
  const chars = article.sentences.reduce((n, s) => n + s.length, 0);
  if (article.sentences.length < 3 || chars < 200) {
    return { ok: false, error: '没有在这个页面找到英文正文。可以选中一段文字再精读。' };
  }
  return { ok: true };
}

// 导读请求的正文：段落带编号，小标题原样带上；太长时每段只留开头，保证能覆盖全文
export function outlineInput(items) {
  const list = arr(items);
  const paras = list.filter((it) => it.kind === 'p').length || 1;
  const clip = Math.max(120, Math.min(600, Math.floor(OUTLINE_MAX_CHARS / paras)));
  const lines = [];
  let used = 0;
  let n = 0;
  for (const it of list) {
    let line;
    if (it.kind === 'h') line = '## ' + it.text;
    else {
      n++;
      line = `[${n}] ` + (it.text.length > clip ? it.text.slice(0, clip) + '…' : it.text);
    }
    if (used + line.length > OUTLINE_MAX_CHARS) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

export const OUTLINE_PROMPT = [
  '你是英语精读老师。下面是一篇英文文章，段落前有编号，过长的段落只给了开头。只输出一个 JSON 对象，不要 Markdown。',
  '字段：',
  '- gist：两到三句中文，概括全文讲了什么、作者的核心观点',
  '- sections：按行文顺序划分的结构数组，每项 {"title": 不超过 12 字的中文小标题, "from": 起始段落编号, "to": 结束段落编号, "summary": 一句中文概括这部分}，3 到 8 项，覆盖全文，互不重叠；文章很短时可以少于 3 项',
  '- points：读这篇文章值得留意的地方（论证方式、作者态度、文体特点、需要的背景知识），中文字符串数组，最多 4 条'
].join('\n');

export function normalizeOutline(obj, paraCount) {
  const o = obj && typeof obj === 'object' ? obj : {};
  const max = Math.max(1, Math.floor(Number(paraCount)) || 1);
  const clamp = (v) => Math.min(max, Math.max(1, Math.round(Number(v))));
  const sections = arr(o.sections)
    .map((s) => {
      const from = clamp(s?.from);
      const to = clamp(s?.to);
      return { title: str(s?.title), summary: str(s?.summary), from, to: Number.isFinite(to) ? Math.max(from, to) : from };
    })
    .filter((s) => Number.isFinite(s.from) && (s.title || s.summary))
    .slice(0, 10);
  return { gist: str(o.gist), sections, points: arr(o.points).map(str).filter(Boolean).slice(0, 4) };
}

export async function analyzeOutline(title, items, cfg, fetchImpl) {
  const paraCount = arr(items).filter((it) => it.kind === 'p').length;
  const messages = [
    { role: 'system', content: OUTLINE_PROMPT },
    { role: 'user', content: (title ? `标题：${title}\n\n` : '') + outlineInput(items) }
  ];
  const { obj, usage, model } = await askJson(messages, cfg, 1000, fetchImpl);
  const data = normalizeOutline(obj, paraCount);
  if (!data.gist && !data.sections.length) throw new Error('模型没有返回导读');
  return { data, usage, model };
}

// 长文本做缓存键太占地方，用长度 + 两个 32 位哈希代替
export function textDigest(text) {
  const src = String(text || '');
  let a = 0x811c9dc5;
  let b = 5381;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = (Math.imul(b, 33) + c) >>> 0;
  }
  return `${src.length}-${a.toString(16)}-${b.toString(16)}`;
}
