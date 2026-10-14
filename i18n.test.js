/* 文案表自检：node i18n.test.js（不依赖 Zotero）。改 i18n.js 后必须跑这一条。
   为什么要这些断言：key 对不上时界面里会冒出 key 本身（`res.have` 这种），占位符对不上会留下
   `{0}` 或吃掉参数 —— 两种都是肉眼很难发现的。 */
'use strict';

const assert = require('assert');
const i18n = require('./i18n.js');

// 1) 两种语言的 key 集合必须完全一致
const zh = Object.keys(i18n.table.zh).sort();
const en = Object.keys(i18n.table.en).sort();
assert.deepStrictEqual(en, zh,
  `zh/en 的 key 对不上：只在 zh=${zh.filter((k) => !en.includes(k))} / 只在 en=${en.filter((k) => !zh.includes(k))}`);

// 2) 每条文案的占位符集合也必须一致（`{0}` `{1}` …）
const holders = (s) => (String(s).match(/\{\d+\}/g) || []).sort();
for (const key of zh) {
  assert.deepStrictEqual(holders(i18n.table.en[key]), holders(i18n.table.zh[key]),
    `占位符不一致：${key}\n  zh=${i18n.table.zh[key]}\n  en=${i18n.table.en[key]}`);
}

// 3) 不许有空串、也不许没翻译（内容等于 key 本身就是没翻）
for (const key of zh) {
  for (const lang of ['zh', 'en']) {
    const s = i18n.table[lang][key];
    assert.ok(typeof s === 'string' && s.trim(), `${lang}.${key} 是空的`);
    assert.notStrictEqual(s, key, `${lang}.${key} 没翻译（内容等于 key）`);
  }
}

// 4) resolve：pref 值优先，'auto'/空/不认识 → 跟 Zotero 的界面语言（没给就当 zh）
assert.strictEqual(i18n.resolve('zh', 'en-US'), 'zh');
assert.strictEqual(i18n.resolve('EN', 'zh-CN'), 'en');
assert.strictEqual(i18n.resolve('zh-CN', ''), 'zh');
assert.strictEqual(i18n.resolve('auto', 'zh-CN'), 'zh');
assert.strictEqual(i18n.resolve('auto', 'en-US'), 'en');
assert.strictEqual(i18n.resolve('', ''), 'zh');
assert.strictEqual(i18n.resolve('garbage', 'en-US'), 'en', '不认识的 pref 值要退回界面语言');
assert.strictEqual(i18n.resolve(null, undefined), 'zh');

// 5) t：替换占位符；不认识的语言退回 zh；缺 key 原样返回（看得见，不静默变空）
assert.strictEqual(i18n.t('zh', 'res.have', 'X'), '【已有】X');
assert.strictEqual(i18n.t('en', 'res.have', 'X'), '[already has PDF] X');
assert.strictEqual(i18n.t('en', 'res.added', 'A', 'unpaywall', 1234), '[added] A — unpaywall 1234KB');
assert.strictEqual(i18n.t('zh', 'res.paywall', 'T', 'closed'),
  '【付费墙】T — 没有 OA 副本（Unpaywall: closed），不是被墙');
assert.strictEqual(i18n.t('en', 'res.failed', 'S', '10.1/x', 'cf_challenge', ' (exit 7)'),
  '[failed] S — 10.1/x | cf_challenge (exit 7)');
assert.strictEqual(i18n.t('en', 'no.such.key'), 'no.such.key');
assert.strictEqual(i18n.t('de', 'res.have', 'X'), '【已有】X', '不认识的语言退回 zh');

console.log(`i18n.test.js: OK（key 对齐 ${zh.length} 条 / 占位符 / resolve 8 例 / 替换 7 例）`);
