/* 进度窗自检：node litfetch.progress.test.js（不依赖 Zotero，但要把 Zotero 的 ProgressWindow stub 出来）。
   锁住一条实测踩过的坑：Zotero 7 的 `startCloseTimer` 收的是**毫秒**，传 0 = 下一个 tick 关窗。
   多条目连着下载时「第一篇的提示一出来就没了、后面条目再没提示」，根因就在 `_progress` 每次换标题都
   传了 0。改 litfetch.js 的 UI 那一段后跑这一条。 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ── 最小 stub：只覆盖 _progress / _addProgressLine 走过的路径
function makeWin() {
  const calls = [];
  const win = {
    calls,
    show() { calls.push('show'); return true; },
    changeHeadline(t) { calls.push(['changeHeadline', t]); },
    addLines(ls) { calls.push(['addLines', ...ls]); },
    startCloseTimer(ms) { calls.push(['startCloseTimer', ms]); },
  };
  return win;
}
// Prefs 读不到就吃 fallback（_pref 自己有 try/catch，这里干脆不给 Prefs）；locale=zh-CN → 文案走中文
const Zotero = { debug() {}, ProgressWindow: function () { return makeWin(); }, locale: 'zh-CN' };

const i18n = require('./i18n.js');
const src = fs.readFileSync(path.join(__dirname, 'litfetch.js'), 'utf8');
const LitFetch = new Function('Zotero', 'IOUtils', 'PathUtils', 'LitFetchCore', 'LitFetchI18n',
  `${src}\n;return LitFetch;`)(Zotero, {}, {}, {}, i18n);

// 1) 换标题（closeAfterMs=0）绝不能给 Zotero 7 设关闭计时器 —— 那就是「一出现就关」
const w1 = makeWin();
LitFetch._progress('lit-fetch：2/5　某篇文献', [], 0, w1);
assert.ok(!w1.calls.some((c) => Array.isArray(c) && c[0] === 'startCloseTimer'),
  `换标题不该设关闭计时器，实际调用：${JSON.stringify(w1.calls)}`);
assert.deepStrictEqual(w1.calls.slice(0, 2), ['show', ['changeHeadline', 'lit-fetch：2/5　某篇文献']],
  `先开窗再改标题（窗被点掉过也要能开回来），实际调用：${JSON.stringify(w1.calls)}`);

// 2) 收尾那次给了 15000 → 要原样设上去（毫秒）
const w2 = makeWin();
LitFetch._progress('lit-fetch：完成 1/1', ['【已补】x — unpaywall 100KB'], 15000, w2);
assert.deepStrictEqual(
  w2.calls.filter((c) => Array.isArray(c) && c[0] === 'startCloseTimer'),
  [['startCloseTimer', 15000]], JSON.stringify(w2.calls));

// 3) 加行：先 show 再加行（用户点掉过 / 窗被关过也要能开回来）
const w3 = makeWin();
LitFetch.pw = w3;
LitFetch.pwLines = 0;
LitFetch._addProgressLine('  → 试 unpaywall: https://…');
assert.deepStrictEqual(w3.calls, ['show', ['addLines', '  → 试 unpaywall: https://…']],
  JSON.stringify(w3.calls));

// 4) 行数上限照旧：到 14 行就不再动窗（也不 show）
const w4 = makeWin();
LitFetch.pw = w4;
LitFetch.pwLines = 14;
LitFetch._addProgressLine('  → 又来一行');
assert.deepStrictEqual(w4.calls, [], JSON.stringify(w4.calls));

// 5) 文案走 pref `lang`：default(auto)+locale=zh-CN → 中文菜单；pref 给 en 就是英文
assert.strictEqual(LitFetch._label(), '补 PDF（lit-fetch）');
LitFetch._pref = () => 'en';
assert.strictEqual(LitFetch._label(), 'Fetch PDF (lit-fetch)');

console.log('litfetch.progress.test.js: OK（关闭计时 2 例 / 加行 2 例 / 文案 2 例）');

