// 独立的精读页面：内容来自精读记录（storage 键 readings），这里按 id 取出，交给同一套侧栏代码铺满整页显示
(async () => {
  const id = new URLSearchParams(location.search).get('id') || '';
  const { readings = {} } = await chrome.storage.local.get('readings');
  const entry = readings[id];
  const doc = entry?.doc;
  if (!doc || !window.__htDeep?.restore({ ...doc, active: entry.active }, id)) {
    document.getElementById('empty').hidden = false;
    return;
  }
  if (doc.title) document.title = '精读 · ' + doc.title;
})();
