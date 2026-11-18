// chrome.storage 读-改-写不是原子的；精读会并发写缓存和统计，统一排队避免互相覆盖
let tail = Promise.resolve();

export function withLock(fn) {
  const run = tail.then(fn, fn);
  tail = run.catch(() => {});
  return run;
}
