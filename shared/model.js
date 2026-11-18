import { normalizeUsage } from './usage.js';

const SYSTEM_PROMPT = [
  '你是一个英译中的翻译引擎。',
  '判断输入属于单词、固定短语/习语，还是句子/段落：',
  '1) 单词：第一行给出词性 + 中文释义，多个常用义项用 / 分隔，例如：v. 放弃；n. 沙漠',
  '2) 固定短语或习语：第一行给出最贴切的中文含义，必要时用一句话点明用法',
  '3) 句子或段落：给出自然流畅的中文翻译，不加例句',
  '单词和短语在释义之后再写两行：',
  '例句：一句简短常用、包含该词或短语的英文例句',
  '例译：该例句的中文翻译',
  '不要写「单词/短语/习语/谚语」之类的类别名，不要复述原文，不要解释过程，不要使用 Markdown 标记。'
].join('\n');

function clean(text) {
  let out = String(text || '').trim();
  out = out.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  out = out.replace(/^(译文|翻译|translation)\s*[:：]\s*/i, '').trim();
  out = out.replace(/^(单词|短语|固定短语|习语|谚语|句子|段落)(\s*[\/／、或]\s*(短语|习语|谚语))?\s*[:：]\s*/, '').trim();
  out = out.replace(/^【[^】]{1,8}】\s*/, '').trim();
  const wrapped = out.match(/^\*\*([\s\S]+)\*\*$/) || out.match(/^"([\s\S]+)"$/);
  if (wrapped) out = wrapped[1].trim();
  return out;
}

const EXAMPLE_RE = /^例句\s*[:：]\s*(.+)$/;
const EXAMPLE_ZH_RE = /^例译\s*[:：]\s*(.+)$/;

export function splitExample(text) {
  let en = '';
  let zh = '';
  const rest = [];
  String(text || '')
    .split('\n')
    .forEach((line) => {
      const t = line.trim();
      const a = t.match(EXAMPLE_RE);
      const b = t.match(EXAMPLE_ZH_RE);
      if (a && !en) en = a[1].trim();
      else if (b && !zh) zh = b[1].trim();
      else rest.push(line);
    });
  return { translation: clean(rest.join('\n')), example: en ? { en, zh } : null };
}

function endpoint(baseUrl) {
  const base = String(baseUrl).trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
}

// 通用 chat/completions 调用：返回 { content, model, usage }
export async function chat(messages, cfg, opts = {}, fetchImpl) {
  if (!cfg.apiKey) throw new Error('缺少 API Key，请在设置页填写');
  const doFetch = fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || cfg.timeoutMs || 30000);
  const payload = {
    model: opts.model || cfg.model,
    temperature: opts.temperature ?? cfg.temperature ?? 0.2,
    max_tokens: opts.maxTokens || cfg.maxTokens || 1024,
    messages
  };
  if (opts.json) payload.response_format = { type: 'json_object' };
  if (cfg.thinking !== true) payload.reasoning_effort = 'none';
  try {
    const res = await doFetch(endpoint(cfg.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.error?.message || ('HTTP ' + res.status));
    }
    return {
      content: String(data?.choices?.[0]?.message?.content || ''),
      model: data?.model || payload.model,
      usage: normalizeUsage(data?.usage)
    };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('请求超时，请检查网络或接口地址');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function translateText(text, cfg, fetchImpl) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        '把下面的英文翻译成中文：\n' +
        text +
        (cfg.requireExample ? '\n\n（这是单词，释义之后必须写「例句：」和「例译：」两行）' : '')
    }
  ];
  const out = await chat(messages, cfg, {}, fetchImpl);
  const { translation, example } = splitExample(clean(out.content));
  if (!translation) throw new Error('模型没有返回译文');
  return { translation, example, model: out.model, usage: out.usage };
}
