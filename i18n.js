/* lit-fetch 插件的界面/日志文案（zh / en）。纯逻辑、不依赖 Zotero —— node 里也能跑（i18n.test.js），
   在 Zotero 沙箱里由 bootstrap.js 用 loadSubScript 载入，挂到沙箱全局的 LitFetchI18n 上。

   用法：
     const lang = LitFetchI18n.resolve(pref, Zotero.locale);   // pref: 'auto'|'zh'|'en'
     LitFetchI18n.t(lang, 'res.added', 'Zhang_2025_x', 'unpaywall', 1234);

   约定：`{0}`/`{1}`… 是占位符；key 在表里找不到就原样返回 key（看得见、不会静默变空）。
   i18n.test.js 会断言两种语言 key 集合完全一致、占位符一一对应。 */
(function (root) {
  'use strict';

  var TABLE = {
    zh: {
      'menu.label': '补 PDF（lit-fetch）',

      'ui.spawning': '▸ 正在启动后端进程…（首次要几秒，起来后常驻）',
      'ui.ready': '▸ 后端就绪（v{0}）',
      'ui.pick': 'lit-fetch：请先选中文献条目',
      'ui.headline': 'lit-fetch：{0}/{1}　{2}',
      'ui.done': 'lit-fetch：完成 {0}/{1}',
      'ui.err': 'lit-fetch：出错了（详见 Help→Debug Output / litfetch.log）',
      'ui.item': '条目 {0}',
      'ui.processing': '▸ 处理 {0}',

      'res.added': '【已补】{0} — {1} {2}KB',
      'res.have': '【已有】{0}',
      'res.noid': '【无标识符】{0}',
      'res.paywall': '【付费墙】{0} — 没有 OA 副本（Unpaywall: {1}），不是被墙',
      'res.failed': '【失败】{0} — {1}｜{2}{3}',
      'res.orphan': '【下载成功但挂不上去】{0} — 文件在 {1}',

      'log.init': 'init 起 v{0}',
      'log.menu_broken': 'Zotero.MenuManager.registerMenu 不可用（MenuManager={0}）—— 菜单注册不了',
      'log.registered': 'registerMenu({0}) -> {1}',
      'log.python_fallback': 'pref 里的 python 不存在，改用 PATH 上的：{0}',
      'log.spawned': '已启动 lit-fetch: {0} {1} rpc',
      'log.child_killed': '子进程已终止：{0}',
      'log.stdout_nonjson': 'stdout 有非 JSON 行（应走 stderr）：{0}',
      'log.stdout_closed': '子进程的 stdout 关了{0}',
      'log.stdout_tail': '；stderr 末尾：{0}',
      'log.frame_unmatched': '收到未匹配的帧：{0}',
      'log.timeout_kill': '{0} 超时 {1}ms',
      'log.timeout': '{0} 超时（{1}s）—— 已重启后端',
      'log.write_failed': '写子进程失败：{0}',
      'log.ident_failed': '抽标识符失败：{0}',
      'log.busy_click': '上一轮还在跑，忽略这次点击',
      'log.no_items': '没有选中任何文献条目',
      'log.item_failed': '「{0}」失败：{1}',
      'log.attach_failed': '附件导入失败（文件已下到 {0}）：{1}',
      'log.pw_failed': '进度窗失败：{0}',
      'log.pw_line_failed': '进度窗加行失败：{0}',
      'log.backend_failed': '后端报失败：{0} {1} exit={2}',
      'log.uncaught': '未捕获：{0}',

      'err.subprocess': 'Subprocess 模块不可用',
      'err.child_ended': '子进程已结束（{0}）',

      'pane.label': 'lit-fetch',
      'pane.section.fetch': '抓取',
      'pane.allowBrowser': '允许走浏览器那一层（layer2）',
      'pane.allowBrowser.hint': '关掉就只走纯 HTTP 路线；bot 墙和付费刊那些需要真浏览器的会拿不到。',
      'pane.paywall': '付费刊也试一次出版商的正文页',
      'pane.paywall.hint': '有机构 IP（校网/VPN）时这是唯一能拿到付费文献的路；关掉＝只做开放获取。',
      'pane.skipExisting': '条目已有 PDF 就跳过',
      'pane.timeout': '单条超时（秒）',
      'pane.section.lang': '语言',
      'pane.lang.label': '界面与日志语言',
      'pane.lang.auto': '跟随 Zotero',
      'pane.section.paths': '后端与路径',
      'pane.paths.hint': '这些是 lit-fetch 本体（另一个仓库）的位置，一般不用改；留空就用默认值。',
      'pane.paths.python': 'python 解释器',
      'pane.paths.script': 'lit_fetch.py',
      'pane.paths.outDir': '下载临时目录',
      'pane.paths.email': '联系邮箱',
      'log.pane_ok': '已注册设置面板 {0}',
      'log.pane_broken': 'Zotero.PreferencePanes 不可用（{0}）—— 设置面板注册不了',
      'log.pane_failed': '设置面板注册失败：{0}',
      'log.pane_script': '设置面板脚本已载入',
      'log.pane_init': '设置面板初始化完成（onload 跑到了）',
    },
    en: {
      'menu.label': 'Fetch PDF (lit-fetch)',

      'ui.spawning': '▸ Starting the backend process… (a few seconds the first time, then it stays warm)',
      'ui.ready': '▸ Backend ready (v{0})',
      'ui.pick': 'lit-fetch: select some items first',
      'ui.headline': 'lit-fetch: {0}/{1}  {2}',
      'ui.done': 'lit-fetch: done {0}/{1}',
      'ui.err': 'lit-fetch: something broke (see Help → Debug Output / litfetch.log)',
      'ui.item': 'item {0}',
      'ui.processing': '▸ {0}',

      'res.added': '[added] {0} — {1} {2}KB',
      'res.have': '[already has PDF] {0}',
      'res.noid': '[no identifier] {0}',
      'res.paywall': '[paywall] {0} — no OA copy (Unpaywall: {1}); not a bot wall',
      'res.failed': '[failed] {0} — {1} | {2}{3}',
      'res.orphan': '[downloaded, but attaching failed] {0} — file at {1}',

      'log.init': 'init v{0}',
      'log.menu_broken': 'Zotero.MenuManager.registerMenu unavailable (MenuManager={0}) — menu not registered',
      'log.registered': 'registerMenu({0}) -> {1}',
      'log.python_fallback': 'python from prefs not found, falling back to the one on PATH: {0}',
      'log.spawned': 'started lit-fetch: {0} {1} rpc',
      'log.child_killed': 'child process killed: {0}',
      'log.stdout_nonjson': 'non-JSON line on stdout (should go to stderr): {0}',
      'log.stdout_closed': 'child stdout closed{0}',
      'log.stdout_tail': '; stderr tail: {0}',
      'log.frame_unmatched': 'unmatched frame: {0}',
      'log.timeout_kill': '{0} timed out after {1}ms',
      'log.timeout': '{0} timed out ({1}s) — backend restarted',
      'log.write_failed': 'writing to the child process failed: {0}',
      'log.ident_failed': 'identifier extraction failed: {0}',
      'log.busy_click': 'previous run still going, ignoring this click',
      'log.no_items': 'no regular items selected',
      'log.item_failed': '“{0}” failed: {1}',
      'log.attach_failed': 'attachment import failed (file downloaded to {0}): {1}',
      'log.pw_failed': 'progress window failed: {0}',
      'log.pw_line_failed': 'adding a progress line failed: {0}',
      'log.backend_failed': 'backend reported failure: {0} {1} exit={2}',
      'log.uncaught': 'uncaught: {0}',

      'err.subprocess': 'Subprocess module unavailable',
      'err.child_ended': 'child process ended ({0})',

      'pane.label': 'lit-fetch',
      'pane.section.fetch': 'Fetching',
      'pane.allowBrowser': 'Allow the browser layer (layer2)',
      'pane.allowBrowser.hint': 'Off = HTTP-only routes; bot walls and paywalled items need a real browser.',
      'pane.paywall': 'Try the publisher page for paywalled items',
      'pane.paywall.hint': 'With an institutional IP (campus VPN) this is the only way to reach closed-access '
        + 'papers; off = open access only.',
      'pane.skipExisting': 'Skip items that already have a PDF',
      'pane.timeout': 'Per-item timeout (seconds)',
      'pane.section.lang': 'Language',
      'pane.lang.label': 'Interface and log language',
      'pane.lang.auto': 'Follow Zotero',
      'pane.section.paths': 'Backend & paths',
      'pane.paths.hint': "These point at lit-fetch itself (a separate repo) and usually don't need changing; "
        + 'empty = built-in default.',
      'pane.paths.python': 'python interpreter',
      'pane.paths.script': 'lit_fetch.py',
      'pane.paths.outDir': 'Temp download dir',
      'pane.paths.email': 'Contact email',
      'log.pane_ok': 'registered settings pane {0}',
      'log.pane_broken': 'Zotero.PreferencePanes unavailable ({0}) — settings pane not registered',
      'log.pane_failed': 'registering the settings pane failed: {0}',
      'log.pane_script': 'settings pane script loaded',
      'log.pane_init': 'settings pane initialised (onload ran)',
    },
  };

  var LANGS = ['zh', 'en'];

  // pref 值（'auto'|'zh'|'en'，大小写随意、zh-CN 这种也认）→ 真正用哪种语言。
  // 'auto'/空/不认识：看 Zotero 的界面语言（没传 locale 就当 zh）。
  function resolve(pref, locale) {
    var s = String(pref === undefined || pref === null ? '' : pref).toLowerCase();
    if (s.indexOf('zh') === 0 || s === 'cn') {
      return 'zh';
    }
    if (s.indexOf('en') === 0) {
      return 'en';
    }
    var loc = String(locale === undefined || locale === null ? '' : locale).toLowerCase();
    return loc.indexOf('zh') === 0 ? 'zh' : (loc ? 'en' : 'zh');
  }

  function t(lang, key) {
    var table = TABLE[LANGS.indexOf(lang) === -1 ? 'zh' : lang];
    var text = table[key];
    if (text === undefined) {
      return key;                  // 缺 key 就原样返回：看得见，不会静默变空
    }
    for (var i = 2; i < arguments.length; i++) {
      text = text.split('{' + (i - 2) + '}').join(String(arguments[i]));
    }
    return text;
  }

  var api = { LANG_LIST: LANGS.slice(), table: TABLE, resolve: resolve, t: t };

  root.LitFetchI18n = api;
  if (typeof module === 'object' && module.exports) {
    module.exports = api;          // node 自检用
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
