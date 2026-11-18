export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const input = num(usage.prompt_tokens ?? usage.input ?? usage.input_tokens);
  const output = num(usage.completion_tokens ?? usage.output ?? usage.output_tokens);
  const total = num(usage.total_tokens ?? usage.total) || input + output;
  if (!input && !output && !total) return null;
  return {
    input,
    output,
    total,
    cachedInput: num(usage.prompt_tokens_details?.cached_tokens ?? usage.cachedInput),
    reasoning: num(usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning)
  };
}

export function sumUsage(a, b) {
  const x = normalizeUsage(a);
  const y = normalizeUsage(b);
  if (!x || !y) return x || y;
  return {
    input: x.input + y.input,
    output: x.output + y.output,
    total: x.total + y.total,
    cachedInput: x.cachedInput + y.cachedInput,
    reasoning: x.reasoning + y.reasoning
  };
}

export function addUsage(stats, usage) {
  const u = normalizeUsage(usage);
  if (!u) return stats;
  stats.tokensIn = (stats.tokensIn || 0) + u.input;
  stats.tokensOut = (stats.tokensOut || 0) + u.output;
  stats.tokensTotal = (stats.tokensTotal || 0) + u.total;
  stats.tokensCached = (stats.tokensCached || 0) + u.cachedInput;
  stats.tokenRequests = (stats.tokenRequests || 0) + 1;
  return stats;
}

export function estimateCost(tokens, prices) {
  const inPrice = Number(prices?.inPrice) || 0;
  const outPrice = Number(prices?.outPrice) || 0;
  if (!inPrice && !outPrice) return null;
  const u = normalizeUsage(tokens);
  const hasTotals = !!tokens && (tokens.tokensIn != null || tokens.tokensOut != null);
  if (!u && !hasTotals) return null;
  const input = u ? u.input : Number(tokens.tokensIn) || 0;
  const output = u ? u.output : Number(tokens.tokensOut) || 0;
  return (input / 1e6) * inPrice + (output / 1e6) * outPrice;
}

export function formatTokens(n) {
  return (Number(n) || 0).toLocaleString('en-US');
}

export function formatUsage(usage) {
  const u = normalizeUsage(usage);
  if (!u) return '';
  return `tokens ${formatTokens(u.total)}（入 ${formatTokens(u.input)} / 出 ${formatTokens(u.output)}）`;
}

export function formatCost(cost, symbol = '¥') {
  if (cost === null || cost === undefined || cost === '') return '';
  const value = Number(cost);
  if (!Number.isFinite(value)) return '';
  if (value === 0) return symbol + '0';
  return symbol + (value < 0.01 ? value.toFixed(4) : value.toFixed(2));
}