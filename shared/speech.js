export const SPEAK_MAX_CHARS = 300;

export function clampSpeakText(text, max = SPEAK_MAX_CHARS) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length <= max ? t : t.slice(0, max) + '…';
}

export function pickVoice(voices, preferredName, langPrefix = 'en') {
  const list = (Array.isArray(voices) ? voices : []).filter((v) => v && v.name);
  if (!list.length) return null;
  if (preferredName) {
    const exact = list.find((v) => v.name === preferredName);
    if (exact) return exact;
  }
  const prefix = String(langPrefix || 'en').toLowerCase();
  const matched = list.filter((v) => String(v.lang || '').toLowerCase().startsWith(prefix));
  if (matched.length) return matched.find((v) => v.localService) || matched[0];
  return list.find((v) => v.localService) || list[0];
}
