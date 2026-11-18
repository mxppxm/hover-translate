import { MODEL_PRESETS, getConfig, getDefaults } from '../shared/config.js';
import { translateText } from '../shared/model.js';
import { estimateCost, formatCost, formatTokens, formatUsage } from '../shared/usage.js';
import { pickVoice } from '../shared/speech.js';

const el = (id) => document.getElementById(id);

const datalist = el('models');
MODEL_PRESETS.forEach((name) => {
  const opt = document.createElement('option');
  opt.value = name;
  datalist.appendChild(opt);
});

function fill(cfg) {
  ['baseUrl', 'apiKey', 'model', 'temperature', 'maxTokens', 'timeoutMs', 'speakRate', 'inPrice', 'outPrice'].forEach((key) => {
    el(key).value = cfg[key];
  });
  el('thinking').checked = cfg.thinking === true;
  el('autoTranslate').checked = cfg.autoTranslate !== false;
  el('autoSpeak').checked = cfg.autoSpeak === true;
  el('level').value = cfg.level || 'cet6';
  el('showIpa').checked = cfg.showIpa !== false;
  el('markVocab').checked = cfg.markVocab !== false;
  el('speakVoice').dataset.saved = cfg.speakVoice || '';
  selectSavedVoice();
}

function collect() {
  return {
    baseUrl: el('baseUrl').value.trim(),
    apiKey: el('apiKey').value.trim(),
    model: el('model').value.trim(),
    temperature: Number(el('temperature').value),
    maxTokens: Number(el('maxTokens').value),
    timeoutMs: Number(el('timeoutMs').value),
    speakRate: Number(el('speakRate').value),
    speakVoice: el('speakVoice').value,
    inPrice: Number(el('inPrice').value),
    outPrice: Number(el('outPrice').value),
    thinking: el('thinking').checked,
    autoTranslate: el('autoTranslate').checked,
    autoSpeak: el('autoSpeak').checked,
    level: el('level').value,
    showIpa: el('showIpa').checked,
    markVocab: el('markVocab').checked
  };
}

function setResult(node, text, kind) {
  node.textContent = text;
  node.className = 'result' + (kind ? ' ' + kind : '');
}

function listVoices() {
  if (typeof speechSynthesis === 'undefined') return [];
  return (speechSynthesis.getVoices() || []).filter((v) => v && v.name);
}

function renderVoices() {
  const select = el('speakVoice');
  const voices = listVoices();
  const current = select.value || select.dataset.saved || '';
  select.innerHTML = '<option value="">自动（优先英文音色）</option>';
  for (const voice of voices) {
    const opt = document.createElement('option');
    opt.value = voice.name;
    opt.textContent = voice.name + ' · ' + voice.lang + (voice.localService ? ' · 本地' : '');
    select.appendChild(opt);
  }
  if (current && voices.some((v) => v.name === current)) select.value = current;
  return voices;
}

function selectSavedVoice() {
  renderVoices();
}

function speakPreview() {
  const voices = listVoices();
  const voice = pickVoice(voices, el('speakVoice').value);
  if (typeof speechSynthesis === 'undefined') {
    setResult(el('voiceResult'), '当前环境不支持朗读', 'err');
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance('Hello, this is the translation voice.');
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang || 'en-US';
  }
  const rate = Number(el('speakRate').value);
  utterance.rate = Number.isFinite(rate) && rate > 0 ? Math.min(2, Math.max(0.5, rate)) : 1;
  utterance.onend = () => setResult(el('voiceResult'), '试听结束 · ' + (voice ? voice.name : '系统默认'), 'ok');
  utterance.onerror = () => setResult(el('voiceResult'), '该音色无法播放，换一个试试', 'err');
  speechSynthesis.speak(utterance);
  setResult(el('voiceResult'), '试听中… · ' + (voice ? voice.name : '系统默认'));
}

fill(await getConfig());
renderVoices();
if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = renderVoices;

el('toggleKey').addEventListener('click', () => {
  const input = el('apiKey');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  el('toggleKey').textContent = show ? '隐藏' : '显示';
});

el('previewVoice').addEventListener('click', speakPreview);

el('save').addEventListener('click', async () => {
  const next = collect();
  if (!/^https?:\/\//.test(next.baseUrl)) return setResult(el('saved'), '接口地址必须以 http(s):// 开头', 'err');
  await chrome.storage.local.set({ config: next });
  el('speakVoice').dataset.saved = next.speakVoice;
  setResult(el('saved'), '已保存', 'ok');
  setTimeout(() => setResult(el('saved'), ''), 1500);
});

el('reset').addEventListener('click', async () => {
  const defaults = await getDefaults();
  await chrome.storage.local.set({ config: defaults });
  fill(defaults);
  setResult(el('saved'), '已恢复默认配置', 'ok');
});

el('test').addEventListener('click', async () => {
  const node = el('testResult');
  const btn = el('test');
  btn.disabled = true;
  setResult(node, '测试中…');
  try {
    const cfg = { ...collect(), timeoutMs: 20000 };
    const out = await translateText('Hello, world.', cfg);
    const parts = [out.model, out.translation, formatUsage(out.usage) || '接口未返回 token 用量'];
    const cost = estimateCost(out.usage, cfg);
    if (cost !== null) parts.push(formatCost(cost));
    setResult(node, '成功 · ' + parts.filter(Boolean).join(' · '), 'ok');
  } catch (err) {
    setResult(node, '失败 · ' + (err?.message || err), 'err');
  } finally {
    btn.disabled = false;
  }
});