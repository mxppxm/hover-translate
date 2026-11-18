// 独立的精读页面：内容由侧栏的「在新标签页打开」存进 storage，这里按 id 取出，交给同一套侧栏代码铺满整页显示
(async () => {
  const id = new URLSearchParams(location.search).get('id') || '';
  const { reader = {} } = await chrome.storage.local.get('reader');
  const doc = reader[id]?.doc;
  if (!doc || !window.__htDeep?.restore(doc)) {
    document.getElementById('empty').hidden = false;
    return;
  }
  if (doc.title) document.title = '精读 · ' + doc.title;
})();
