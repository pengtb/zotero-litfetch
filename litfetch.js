/* Zotero 侧：条目菜单 → 抽标识符 → 常驻 lit-fetch 子进程（stdio JSON-RPC）→ 附件挂回条目。
   纯逻辑在 core.js（LitFetchCore）；本文件只在 Zotero 沙箱里跑。 */

var LitFetch = {
  pluginID: '',
  rootURI: '',
  child: null,
  spawnPromise: null,
  seq: 0,
  pending: new Map(),
  lineBuf: '',
  stderrTail: [],
  busy: false,
  destroyed: false,
  logPath: null,
  pw: null,          // 当前这轮的进度窗：后端推 note 时往里加行
  pwLines: 0,        // 这轮已加的行数（防长跑把窗撑爆）

  // ── 生命周期 ───────────────────────────────────────────────
  async init({ rootURI, pluginID, version }) {
    this.rootURI = rootURI;
    this.pluginID = pluginID;
    this.version = version;
    this.logPath = PathUtils.join(Zotero.DataDirectory.dir, 'litfetch.log');
    this._log(this._t('log.init', version));          // 第一件事就落盘，后面哪一步炸了也能看出来

    const mm = Zotero.MenuManager;
    if (!mm || typeof mm.registerMenu !== 'function') {
      this._log(this._t('log.menu_broken', typeof mm));
      return;
    }
    const label = this._label();
    const registered = mm.registerMenu({
      menuID: 'litfetch-item-menu',
      pluginID: pluginID,
      target: 'main/library/item',
      menus: [{
        menuType: 'menuitem',
        // ponytail: 不靠 l10nID。插件自带的 ftl 不一定被主窗口的 DOM 本地化解析，解析不到就是
        // 「注册成功但菜单项没字」= 看着像没出现。本机在跑的 v10 插件（zotero-addons 等）都是
        // 在 onShowing 里直接写 label，照抄这条。
        onShowing: (event, context) => {
          if (context && context.menuElem) {
            context.menuElem.setAttribute('label', label);
          }
        },
        onCommand: () => {
          this.fetchSelected().catch((e) => this._fail(e));
        },
      }],
    });
    // 注册是静默失败的（选项类型不符只返回 false/undefined），所以把结果写进日志
    this._log(this._t('log.registered', label, JSON.stringify(registered)));

    await this._registerPrefsPane();
  },

  /** 设置面板（设置 → lit-fetch）。注册失败不该拖垮插件，所以整段 try/catch。 */
  async _registerPrefsPane() {
    try {
      const pp = Zotero.PreferencePanes;
      if (!pp || typeof pp.register !== 'function') {
        this._log(this._t('log.pane_broken', typeof pp));
        return;
      }
      const id = await pp.register({
        pluginID: this.pluginID,
        id: 'litfetch-prefs',
        src: this.rootURI + 'preferences.xhtml',
        scripts: [this.rootURI + 'preferences.js'],
        label: this._t('pane.label'),
        image: this.rootURI + 'icon.png',
        helpURL: 'https://github.com/pengtb/zotero-litfetch#配置设置--高级--配置编辑器',
      });
      this._log(this._t('log.pane_ok', id));
    }
    catch (e) {
      this._log(this._t('log.pane_failed', e.message));
    }
  },

  // ── 语言（pref `lang`：auto|zh|en，默认 auto=跟 Zotero 界面语言）────────────
  _lang() {
    return LitFetchI18n.resolve(this._pref('lang', 'auto'), Zotero.locale);
  },

  _t(key, ...args) {
    return LitFetchI18n.t(this._lang(), key, ...args);
  },

  /** i18n 的公开入口（设置面板那段脚本用它填文案，不直接碰 _t）。 */
  t(key, ...args) {
    return this._t(key, ...args);
  },

  _label() {
    return this._t('menu.label');
  },

  destroy() {
    this.destroyed = true;
    this._killChild('plugin unload');   // why 是个技术原因代号，直接英文，中英两种日志里都读得通
  },

  // ── 配置 ──────────────────────────────────────────────────
  _pref(key, fallback) {
    try {
      // ponytail: 第二个参数必须是 true。不带它时 Zotero.Prefs.get 会在名字前加 `extensions.zotero.`
      // （PREF_BRANCH），于是 `extensions.litfetch.*` 永远读不到、永远走缺口值 —— 设置面板/配置编辑器
      // 里改的东西全部不生效。设置面板那套机制自己就是用 global=true 读写的（preferences.js）。
      const v = Zotero.Prefs.get(`extensions.litfetch.${key}`, true);
      return v === undefined || v === null || v === '' ? fallback : v;
    }
    catch (e) {
      return fallback;
    }
  },

  /** pref 名字 → 缺口值。就这一份：_paths() 和设置面板（把没设过的 pref 补进库里）都读它。 */
  _defaults() {
    return {
      python: 'C:\\Users\\ptbia\\project\\lit-fetch\\.venv\\Scripts\\python.exe',
      script: 'C:\\Users\\ptbia\\project\\lit-fetch\\lit_fetch.py',
      outDir: PathUtils.join(Zotero.DataDirectory.dir, 'litfetch'),
      email: 'ptbian@pku.edu.cn',
      allowBrowser: true,
      paywall: true,
      lang: 'auto',
      timeoutS: 600,
      skipExisting: true,
    };
  },

  _paths() {
    const d = this._defaults();
    return {
      python: this._pref('python', d.python),
      script: this._pref('script', d.script),
      outDir: this._pref('outDir', d.outDir),
      email: this._pref('email', d.email),
      allowBrowser: this._pref('allowBrowser', d.allowBrowser),
      paywall: this._pref('paywall', d.paywall),
      timeoutS: parseInt(this._pref('timeoutS', d.timeoutS), 10) || d.timeoutS,
      skipExisting: this._pref('skipExisting', d.skipExisting),
    };
  },

  // ── 子进程 ────────────────────────────────────────────────
  _subprocess() {
    const CU = ChromeUtils;
    const mod = CU.importESModule('resource://gre/modules/Subprocess.sys.mjs');
    const Subprocess = mod.Subprocess || mod.default || mod;
    if (!Subprocess || typeof Subprocess.call !== 'function') {
      throw new Error(this._t('err.subprocess'));
    }
    return Subprocess;
  },

  async _ensureChild() {
    if (this.child) {
      return this.child;
    }
    if (this.spawnPromise) {
      return this.spawnPromise;
    }
    this.spawnPromise = (async () => {
      const Subprocess = this._subprocess();
      const { python, script } = this._paths();
      let command = python;
      if (!(await IOUtils.exists(command))) {
        command = await Subprocess.pathSearch('python');
        this._log(this._t('log.python_fallback', command));
      }
      const proc = await Subprocess.call({
        command,
        arguments: [script, 'rpc'],
        stderr: 'pipe',
        // Windows 上 Python 默认按 cp936 写 stdout，中文标题会把按行 JSON 打碎
        environment: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
        environmentAppend: true,
      });
      this.child = proc;
      this.lineBuf = '';
      this.stderrTail = [];
      this._readStdout(proc);
      this._readStderr(proc);
      this._log(this._t('log.spawned', command, script));
      this._addProgressLine(this._t('ui.spawning'));
      // 确认协议真的通（也顺带把 python 侧 import 完，第一次 fetch 不必再等）
      const pong = await this._call('ping', {}, 30000);
      this._log(`ping -> ${JSON.stringify(pong)}`);
      this._addProgressLine(this._t('ui.ready', (pong && pong.version) || '?'));
      return proc;
    })();
    try {
      return await this.spawnPromise;
    }
    finally {
      this.spawnPromise = null;
    }
  },

  _killChild(why) {
    const proc = this.child;
    this.child = null;
    this.spawnPromise = null;
    for (const [, pending] of this.pending) {
      pending.reject(new Error(this._t('err.child_ended', why)));
    }
    this.pending.clear();
    if (proc) {
      try {
        proc.kill();
      }
      catch (e) { /* 已经退出了 */ }
      this._log(this._t('log.child_killed', why));
    }
  },

  async _readStdout(proc) {
    while (!this.destroyed && this.child === proc) {
      let chunk;
      try {
        chunk = await proc.stdout.readString();
      }
      catch (e) {
        break;
      }
      if (!chunk) {
        break;
      }
      const { lines, rest } = LitFetchCore.splitLines(this.lineBuf + chunk);
      this.lineBuf = rest;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        let msg;
        try {
          msg = JSON.parse(trimmed);
        }
        catch (e) {
          this._log(this._t('log.stdout_nonjson', trimmed.slice(0, 200)));
          continue;
        }
        this._dispatch(msg);
      }
    }
    if (this.child === proc) {
      const tail = this.stderrTail.join(' | ').slice(-400);
      this._log(this._t('log.stdout_closed', tail ? this._t('log.stdout_tail', tail) : ''));
      this._killChild('stdout closed');
    }
  },

  async _readStderr(proc) {
    if (!proc.stderr || typeof proc.stderr.readString !== 'function') {
      return;
    }
    while (!this.destroyed && this.child === proc) {
      let chunk;
      try {
        chunk = await proc.stderr.readString();
      }
      catch (e) {
        return;
      }
      if (!chunk) {
        return;
      }
      for (const line of chunk.split('\n')) {
        if (!line.trim()) {
          continue;
        }
        this.stderrTail.push(line.trim());
        if (this.stderrTail.length > 40) {
          this.stderrTail.shift();
        }
      }
    }
  },

  _dispatch(msg) {
    if (msg.id !== undefined && msg.id !== null && this.pending.has(msg.id)) {
      const pending = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) {
        pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      }
      else {
        pending.resolve(msg.result);
      }
      return;
    }
    if (msg.method === 'progress') {
      this._onProgress(msg.params || {});
      return;
    }
    this._log(this._t('log.frame_unmatched', JSON.stringify(msg).slice(0, 200)));
  },

  _call(method, params, timeoutMs) {
    return this._ensureChild().then((proc) => new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // 超时后协议状态不可知，直接把子进程收掉，下一轮重开
        this._killChild(this._t('log.timeout_kill', method, timeoutMs));
        reject(new Error(this._t('log.timeout', method, Math.round(timeoutMs / 1000))));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      }
      catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(this._t('log.write_failed', e.message)));
      }
    }));
  },

  // ── 条目 → 请求 ───────────────────────────────────────────
  _identifierFor(item) {
    const text = [
      item.getField('DOI'),
      item.getField('extra'),
      item.getField('url'),
      item.getField('archiveLocation'),
    ].filter(Boolean).join(' ');
    try {
      return LitFetchCore.identifierFrom(Zotero.Utilities.extractIdentifiers(text));
    }
    catch (e) {
      this._log(this._t('log.ident_failed', e.message));
      return '';
    }
  },

  _hasPdf(item) {
    try {
      return item.getAttachments().some((id) => {
        const att = Zotero.Items.get(id);
        return att && !att.deleted && att.attachmentContentType === 'application/pdf';
      });
    }
    catch (e) {
      return false;
    }
  },

  // ── 主流程：给选中的条目补 PDF ──────────────────────────
  async fetchSelected() {
    if (this.busy) {
      this._log(this._t('log.busy_click'));
      return;
    }
    const pane = Zotero.getActiveZoteroPane();
    const items = pane ? pane.getSelectedItems().filter((i) => i.isRegularItem()) : [];
    if (!items.length) {
      this._log(this._t('log.no_items'));
      this._progress(this._t('ui.pick'), [], 6000);
      return;
    }

    this.busy = true;
    const { outDir, email, allowBrowser, paywall, timeoutS, skipExisting } = this._paths();
    await IOUtils.makeDirectory(outDir, { ignoreExisting: true, createAncestors: true });
    const results = [];
    let pw = null;                  // 当前这篇的进度窗（每篇换新：上一篇的行不留在下一篇里）

    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const label = item.getField('title') || this._t('ui.item', item.id);
        pw = this._nextItemWindow(pw, this._t('ui.headline', i + 1, items.length, label.slice(0, 40)));
        this.pw = pw;                 // 这一篇后端的 note 都加进这个窗
        this.pwLines = 0;
        try {
          results.push(await this._fetchOne(item,
            { outDir, email, allowBrowser, paywall, timeoutS, skipExisting }));
        }
        catch (e) {
          this._log(this._t('log.item_failed', label, e.message));
          results.push({ item, status: 'error', detail: e.message });
        }
      }
    }
    finally {
      this.busy = false;
      this.pw = null;               // 这轮完了就别再往后端推的行里加东西
      const lines = results.map((r) => r.line);
      this._closeWindow(pw);        // 最后一篇的窗也关掉，收尾另开一个干净的（只有结果行）
      this._progress(this._t('ui.done', results.filter((r) => r.status === 'ok').length,
        results.length), lines, results.length ? 15000 : 6000);
      lines.forEach((l) => this._log(l));
    }
  },

  async _fetchOne(item, opts) {
    const title = item.getField('title') || '';
    const short = title.slice(0, 40) || this._t('ui.item', item.id);
    if (opts.skipExisting && this._hasPdf(item)) {
      return { item, status: 'skip', line: this._t('res.have', short) };
    }
    const identifier = this._identifierFor(item);
    if (!identifier) {
      return { item, status: 'noid', line: this._t('res.noid', short) };
    }
    const base = LitFetchCore.fileBaseName({
      creators: item.getCreators(),
      date: item.getField('date'),
      title,
    });
    const out = PathUtils.join(opts.outDir, `${base}.pdf`);

    const env = await this._call('fetch', {
      identifier,
      out,
      title,
      email: opts.email,
      allow_browser: !!opts.allowBrowser,
      paywall: !!opts.paywall,
    }, opts.timeoutS * 1000);

    if (!env || !env.ok) {
      if (env && env.paywalled) {
        return {
          item,
          status: 'paywall',
          line: this._t('res.paywall', short, env.oa_status || 'closed'),
        };
      }
      const why = (env && (env.blocked_kind || env.blocked_by)) || 'unknown';
      const code = env && env.exit_code;
      return {
        item,
        status: 'fail',
        line: this._t('res.failed', short, identifier, why,
          code !== undefined ? ` (exit ${code})` : ''),
      };
    }

    // 挂回条目：Zotero 会把文件收进 storage，我们这份临时副本就没用了
    try {
      await Zotero.Attachments.importFromFile({
        file: env.path || out,
        parentItemID: item.id,
        fileBaseName: base,
      });
    }
    catch (e) {
      this._log(this._t('log.attach_failed', env.path || out, e.message));
      return { item, status: 'fail', line: this._t('res.orphan', short, env.path || out) };
    }
    await IOUtils.remove(env.path || out, { ignoreAbsent: true });
    return {
      item,
      status: 'ok',
      line: this._t('res.added', short, env.route || '?', Math.round((env.bytes || 0) / 1024)),
    };
  },

  // ── UI / 日志 ─────────────────────────────────────────────
  /** 换一篇：把上一篇那个进度窗关掉、开一个新的 —— 进度窗里就只剩当前这篇的行（用户要的效果）。 */
  _nextItemWindow(prev, headline) {
    this._closeWindow(prev);
    return this._progress(headline, [], 0);
  },

  _closeWindow(pw) {
    if (!pw) {
      return;
    }
    try {
      pw.close();
    }
    catch (e) {
      this._log(this._t('log.pw_failed', e.message));
    }
  },

  _progress(headline, lines, closeAfterMs, existing) {
    try {
      const pw = existing || new Zotero.ProgressWindow({ closeOnClick: true });
      pw.show();                 // 先确保窗还在：changeHeadline/addLines 都是「等窗加载」的延迟调用
      pw.changeHeadline(headline);
      if (lines && lines.length) {
        pw.addLines(lines);
      }
      // ponytail: Zotero 7 的 startCloseTimer 收的是**毫秒**，`0` 就是「下一个 tick 关窗」（旧 API 是秒，
      // 那时 0 才有「不自动关」的意思）。以前每次换标题都 `startCloseTimer(closeAfterMs || 0)`，
      // 于是多条目连着下的时候，第一篇的进度一出现就被自己关掉，后面的条目再没有提示。
      // 现在只在明确给了正数时才设关闭计时器（收尾那次传 15000＝15 秒）。
      if (closeAfterMs > 0) {
        pw.startCloseTimer(closeAfterMs);
      }
      return pw;
    }
    catch (e) {
      this._log(this._t('log.pw_failed', e.message));
      return existing || null;
    }
  },

  _onProgress(params) {
    const stage = params.stage;
    if (stage === 'start') {
      this._addProgressLine(this._t('ui.processing', params.identifier || '').trim());
      return;
    }
    if (stage === 'note') {
      if (params.message) {
        this._addProgressLine(`　${this._shortNote(params.message)}`);
      }
      return;
    }
    if (stage === 'done' && params.ok === false) {
      this._log(this._t('log.backend_failed', params.identifier, params.route || '', params.exit_code));
    }
  },

  // 后端每试一条路推一行；都加进进度窗（过上限就只落日志），不然长跑会把窗撑爆
  _addProgressLine(text) {
    this._log(text);
    const pw = this.pw;
    if (!pw || this.pwLines >= 14) {
      return;
    }
    try {
      pw.show();                  // 用户点掉过 / 上一轮关过就开回来（addLines 会排进「等窗加载」队列）
      pw.addLines([text]);
      this.pwLines++;
    }
    catch (e) {
      this._log(this._t('log.pw_line_failed', e.message));
    }
  },

  _shortNote(msg) {
    const s = String(msg || '').replace(/\s+/g, ' ').trim();
    return s.length > 62 ? `${s.slice(0, 61)}…` : s;
  },

  _fail(e) {
    this._log(this._t('log.uncaught', e && e.stack ? e.stack : e));
    this._progress(this._t('ui.err'), [], 8000);
  },

  _log(msg) {
    const line = `${new Date().toISOString()} ${msg}`;
    try {
      Zotero.debug(`[litfetch] ${msg}`);
    }
    catch (e) { /* debug 通道不可用也无所谓 */ }
    this._appendLog(line);      // 不 await：写日志失败不该影响功能
  },

  async _appendLog(line) {
    if (!this.logPath) {
      return;
    }
    try {
      // ponytail: 用 Zotero.File 读+写整份（本机 zotero-custom-columns 就是这么记日志的），
      // 不赌 IOUtils.writeUTF8 的 append 选项在插件沙箱里的行为。
      let prev = '';
      try {
        prev = await Zotero.File.getContentsAsync(this.logPath);
      }
      catch (e) {
        prev = '';   // 第一次写：文件还不存在
      }
      await Zotero.File.putContentsAsync(this.logPath, prev + line + '\n');
    }
    catch (e) {
      // 实在写不了就只剩 Zotero.debug 那条（帮助→调试输出日志）
    }
  },
};

Zotero.LitFetch = LitFetch;
