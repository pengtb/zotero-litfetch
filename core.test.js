/* 纯逻辑自检：node core.test.js（不依赖 Zotero）。改 core.js 后必须跑这一条。 */
'use strict';

const assert = require('assert');
const core = require('./core.js');

// ── 标识符挑选：lit-fetch 认 DOI / arXiv / PMID，别的（ISBN、adsBibcode）要丢掉
assert.strictEqual(core.identifierFrom([{ DOI: '10.1038/s41586-020-2649-2' }]), '10.1038/s41586-020-2649-2');
assert.strictEqual(core.identifierFrom([{ arXiv: '0706.0044' }]), 'arXiv:0706.0044');
assert.strictEqual(core.identifierFrom([{ arXiv: 'arxiv: 0706.0044' }]), 'arXiv:0706.0044');
assert.strictEqual(core.identifierFrom([{ PMID: '12345678' }]), 'pmid:12345678');
assert.strictEqual(core.identifierFrom([{ DOI: '10.1/x' }, { arXiv: '0706.0044' }]), '10.1/x', '同时有时 DOI 优先');
assert.strictEqual(core.identifierFrom([{ ISBN: '9783161484100' }]), '', 'ISBN 不该被当成能用的标识符');
assert.strictEqual(core.identifierFrom([{ adsBibcode: '2020ApJ...1..1A' }]), '');
assert.strictEqual(core.identifierFrom([]), '');
assert.strictEqual(core.identifierFrom(null), '');
assert.strictEqual(core.identifierFrom([null, undefined, {}]), '');
assert.strictEqual(core.identifierFrom([{ arXiv: '   ' }]), '', '空白不算');

// ── 文件名：作者姓_年_标题，且不含 Windows 非法字符
const name = core.fileBaseName({
  creators: [{ creatorType: 'editor', lastName: 'Editor' }, { creatorType: 'author', lastName: 'Zhang' }],
  date: '2025-07-01',
  title: 'A/B: test? <draft>',
});
assert.ok(name.startsWith('Zhang_2025_'), name);
assert.ok(!/[\\/:*?"<>|]/.test(name), `文件名里有非法字符：${name}`);
assert.ok(name.length <= 110, '文件名过长');
assert.strictEqual(core.fileBaseName({}), 'untitled', '没作者没标题也要给个名字');
assert.strictEqual(core.fileBaseName({ creators: [{ creatorType: 'author', name: '某机构' }] }), '某机构');
assert.strictEqual(core.fileBaseName({ creators: [{ creatorTypeID: 1, lastName: 'Li' }] }), 'Li',
  'creatorTypeID=1 也要认成作者');
assert.strictEqual(core.fileBaseName({ creators: [{ creatorType: 'editor', lastName: 'Ed' }] }), 'Ed',
  '没有作者时退回第一个 creator');
assert.ok(!core.fileBaseName({ title: 'Trailing dots...' }).endsWith('.'), '结尾的点要去掉');
assert.ok(!core.fileBaseName({ title: 'x'.repeat(300) }).includes(' '), '超长标题要截断且不留尾部空格');

// ── 帧拆分：stdout 按行 JSON
let r = core.splitLines('{"a":1}\n{"b":2}\n{"c"');
assert.deepStrictEqual(r.lines, ['{"a":1}', '{"b":2}']);
assert.strictEqual(r.rest, '{"c"', '半行要留在缓冲里等下一次读');
r = core.splitLines('');
assert.deepStrictEqual(r.lines, []);
assert.strictEqual(r.rest, '');
r = core.splitLines('one\n');
assert.deepStrictEqual(r.lines, ['one']);
assert.strictEqual(r.rest, '');
r = core.splitLines('\n\n');
assert.deepStrictEqual(r.lines, ['', '']);

console.log('core.test.js: OK（标识符 11 例 / 文件名 7 例 / 帧拆分 4 例）');
