/* lit-fetch 插件的纯逻辑（不依赖 Zotero，可 node 自检：core.test.js）。
   在 Zotero 沙箱里是 loadSubScript 进来的，挂到沙箱全局的 LitFetchCore 上。 */
(function (root) {
  'use strict';

  // extractIdentifiers 已按 DOI > ISBN > arXiv > adsBibcode > PMID 的优先级只返回一类，
  // 这里再按 lit-fetch 能认的三种挑一次（ISBN/adsBibcode 它不认）。
  var ID_ORDER = ['DOI', 'arXiv', 'PMID'];

  function identifierFrom(list) {
    if (!Array.isArray(list)) {
      return '';
    }
    for (var i = 0; i < ID_ORDER.length; i++) {
      var key = ID_ORDER[i];
      for (var j = 0; j < list.length; j++) {
        var hit = list[j];
        if (!hit || !hit[key]) {
          continue;
        }
        var value = String(hit[key]).trim();
        if (!value) {
          continue;
        }
        if (key === 'DOI') {
          return value;
        }
        if (key === 'arXiv') {
          return 'arXiv:' + value.replace(/^arxiv:\s*/i, '');
        }
        return 'pmid:' + value.replace(/\D/g, '');
      }
    }
    return '';
  }

  function sanitize(text, maxLen) {
    maxLen = maxLen || 80;
    var s = String(text === undefined || text === null ? '' : text)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLen)
      .replace(/[.\s]+$/, '');
    return s || 'untitled';
  }

  // 附件文件名：作者姓_年_标题（都过一遍 sanitize，够 Zotero 用就行）
  function fileBaseName(item) {
    item = item || {};
    var creators = item.creators || [];
    var author = '';
    var firstAny = '';
    for (var i = 0; i < creators.length; i++) {
      var c = creators[i];
      if (!c) {
        continue;
      }
      var who = c.lastName || c.name || '';
      if (!who) {
        continue;
      }
      if (!firstAny) {
        firstAny = who;
      }
      // creatorType 有的是名字（'author'），有的是数字 id（1 = author），两种都认
      if (c.creatorType === 'author' || c.creatorTypeID === 1) {
        author = who;
        break;
      }
    }
    author = author || firstAny;
    var yearMatch = String(item.date || '').match(/\d{4}/);
    var parts = [author, yearMatch ? yearMatch[0] : ''];
    if (String(item.title || '').trim()) {
      parts.push(sanitize(item.title, 60));   // 没标题就别把 sanitize 的 'untitled' 拼进来
    }
    return sanitize(parts.filter(Boolean).join('_'), 110);
  }

  // 按行拆 stdio 帧：返回本次能处理的行 + 剩下的半行
  function splitLines(buffer) {
    var parts = String(buffer === undefined || buffer === null ? '' : buffer).split('\n');
    var rest = parts.pop();
    return { lines: parts, rest: rest === undefined ? '' : rest };
  }

  var api = {
    ID_ORDER: ID_ORDER,
    identifierFrom: identifierFrom,
    sanitize: sanitize,
    fileBaseName: fileBaseName,
    splitLines: splitLines,
  };

  root.LitFetchCore = api;
  if (typeof module === 'object' && module.exports) {
    module.exports = api; // node 自检用
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
