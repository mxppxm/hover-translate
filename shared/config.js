export const DEFAULTS = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-v4.1-flash',
  temperature: 0.2,
  maxTokens: 1024,
  timeoutMs: 30000,
  autoTranslate: true,
  thinking: false,
  autoSpeak: false,
  speakRate: 1,
  speakVoice: '',
  inPrice: 0,
  outPrice: 0,
  level: 'cet6',
  showIpa: true,
  markVocab: true
};

export const MODEL_PRESETS = [
  'deepseek-v4.1-flash',
  'deepseek-v4-pro-0813',
  'qwen3.8-max'
];

// 可选的本机私有默认值：扩展根目录下的 config.local.json（不入库，见 config.local.example.json）。
// 用来放自己的接口地址和 API Key，这样不用每次重装都去设置页填。
let localDefaults = null;

async function loadLocalDefaults() {
  if (localDefaults) return localDefaults;
  localDefaults = {};
  try {
    const res = await fetch(chrome.runtime.getURL('config.local.json'));
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object' && !Array.isArray(data)) localDefaults = data;
    }
  } catch (_) {}
  return localDefaults;
}

export async function getDefaults() {
  return { ...DEFAULTS, ...(await loadLocalDefaults()) };
}

export async function getConfig() {
  const [defaults, stored] = await Promise.all([getDefaults(), chrome.storage.local.get('config')]);
  return { ...defaults, ...(stored.config || {}) };
}
