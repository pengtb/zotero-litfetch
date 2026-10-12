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
    this._log(`init 起 v${version}`);          // 第一件事就落盘，后面哪一步炸了也能看出来

    const mm = Zotero.MenuManager;
    if (!mm || typeof mm.registerMenu !== 'function') {
      this._log(`Zotero.MenuManager.registerMenu 不可用（MenuManager=${typeof mm}）—— 菜单注册不了`);
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
    this._log(`registerMenu(${label}) -> ${JSON.stringify(registered)}`);
  },

  _label() {
    const zh = String(Zotero.locale || '').toLowerCase().startsWith('zh');
    return zh ? '补 PDF（lit-fetch）' : 'Fetch PDF (lit-fetch)';
  },

  destroy() {
    this.destroyed = true;
    this._killChild('插件卸载');
  },

  // ── 配置 ──────────────────────────────────────────────────
  _pref(key, fallback) {
    try {
      const v = Zotero.Prefs.get(`extensions.litfetch.${key}`);
      return v === undefined || v === null || v === '' ? fallback : v;
    }
    catch (e) {
      return fallback;
    }
  },

  _paths() {
    return {
      python: this._pref('python', 'C:\\Users\\ptbia\\project\\lit-fetch\\.venv\\Scripts\\python.exe'),
      script: this._pref('script', 'C:\\Users\\ptbia\\project\\lit-fetch\\lit_fetch.py'),
      outDir: this._pref('outDir', PathUtils.join(Zotero.DataDirectory.dir, 'litfetch')),
      email: this._pref('email', 'ptbian@pku.edu.cn'),
      allowBrowser: this._pref('allowBrowser', true),
      timeoutS: parseInt(this._pref('timeoutS', 600), 10) || 600,
    };
  },

  // ── 子进程 ────────────────────────────────────────────────
  _subprocess() {
    const CU = ChromeUtils;
    const mod = CU.importESModule('resource://gre/modules/Subprocess.sys.mjs');
    const Subprocess = mod.Subprocess || mod.default || mod;
    if (!Subprocess || typeof Subprocess.call !== 'function') {
      throw new Error('Subprocess 模块不可用');
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
        this._log(`pref 里的 python 不存在，改用 PATH 上的：${command}`);
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
      this._log(`已启动 lit-fetch: ${command} ${script} rpc`);
      this._addProgressLine('▸ 正在启动后端进程…（首次要几秒，起来后常驻）');
      // 确认协议真的通（也顺带把 python 侧 import 完，第一次 fetch 不必再等）
      const pong = await this._call('ping', {}, 30000);
      this._log(`ping -> ${JSON.stringify(pong)}`);
      this._addProgressLine(`▸ 后端就绪（v${(pong && pong.version) || '?'}）`);
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
      pending.reject(new Error(`子进程已结束（${why}）`));
    }
    this.pending.clear();
    if (proc) {
      try {
        proc.kill();
      }
      catch (e) { /* 已经退出了 */ }
      this._log(`子进程已终止：${why}`);
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
          this._log(`stdout 有非 JSON 行（应走 stderr）：${trimmed.slice(0, 200)}`);
          continue;
        }
        this._dispatch(msg);
      }
    }
    if (this.child === proc) {
      const tail = this.stderrTail.join(' | ').slice(-400);
      this._log(`子进程的 stdout 关了${tail ? `；stderr 末尾：${tail}` : ''}`);
      this._killChild('stdout 关闭');
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
    this._log(`收到未匹配的帧：${JSON.stringify(msg).slice(0, 200)}`);
  },

  _call(method, params, timeoutMs) {
    return this._ensureChild().then((proc) => new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // 超时后协议状态不可知，直接把子进程收掉，下一轮重开
        this._killChild(`${method} 超时 ${timeoutMs}ms`);
        reject(new Error(`${method} 超时（${Math.round(timeoutMs / 1000)}s）—— 已重启后端`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      }
      catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`写子进程失败：${e.message}`));
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
      this._log(`抽标识符失败：${e.message}`);
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
      this._log('上一轮还在跑，忽略这次点击');
      return;
    }
    const pane = Zotero.getActiveZoteroPane();
    const items = pane ? pane.getSelectedItems().filter((i) => i.isRegularItem()) : [];
    if (!items.length) {
      this._log('没有选中任何文献条目');
      this._progress('lit-fetch：请先选中文献条目', [], 6000);
      return;
    }

    this.busy = true;
    const { outDir, email, allowBrowser, timeoutS } = this._paths();
    await IOUtils.makeDirectory(outDir, { ignoreExisting: true, createAncestors: true });
    const results = [];
    const pw = this._progress(`lit-fetch：0/${items.length}`, [], 0);

    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const label = item.getField('title') || `条目 ${item.id}`;
        this.pw = pw;                 // 这一轮后端的 note 都加进这个窗
        this.pwLines = 0;
        this._progress(`lit-fetch：${i + 1}/${items.length}　${label.slice(0, 40)}`, [], 0, pw);
        try {
          results.push(await this._fetchOne(item, { outDir, email, allowBrowser, timeoutS }));
        }
        catch (e) {
          this._log(`「${label}」失败：${e.message}`);
          results.push({ item, status: 'error', detail: e.message });
        }
      }
    }
    finally {
      this.busy = false;
      this.pw = null;               // 这轮完了就别再往后端推的行里加东西
      const lines = results.map((r) => r.line);
      this._progress(`lit-fetch：完成 ${results.filter((r) => r.status === 'ok').length}/${results.length}`,
        lines, results.length ? 15000 : 6000, pw);
      lines.forEach((l) => this._log(l));
    }
  },

  async _fetchOne(item, opts) {
    const title = item.getField('title') || '';
    const short = title.slice(0, 40) || `条目 ${item.id}`;
    if (this._pref('skipExisting', true) && this._hasPdf(item)) {
      return { item, status: 'skip', line: `【已有】${short}` };
    }
    const identifier = this._identifierFor(item);
    if (!identifier) {
      return { item, status: 'noid', line: `【无标识符】${short}` };
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
    }, opts.timeoutS * 1000);

    if (!env || !env.ok) {
      if (env && env.paywalled) {
        return {
          item,
          status: 'paywall',
          line: `【付费墙】${short} — 没有 OA 副本（Unpaywall: ${env.oa_status || 'closed'}），不是被墙`,
        };
      }
      const why = (env && (env.blocked_kind || env.blocked_by)) || 'unknown';
      const code = env && env.exit_code;
      return {
        item,
        status: 'fail',
        line: `【失败】${short} — ${identifier}｜${why}${code !== undefined ? ` (exit ${code})` : ''}`,
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
      this._log(`附件导入失败（文件已下到 ${env.path || out}）：${e.message}`);
      return { item, status: 'fail', line: `【下载成功但挂不上去】${short} — 文件在 ${env.path || out}` };
    }
    await IOUtils.remove(env.path || out, { ignoreAbsent: true });
    return {
      item,
      status: 'ok',
      line: `【已补】${short} — ${env.route || '?'} ${Math.round((env.bytes || 0) / 1024)}KB`,
    };
  },

  // ── UI / 日志 ─────────────────────────────────────────────
  _progress(headline, lines, closeAfterMs, existing) {
    try {
      const pw = existing || new Zotero.ProgressWindow({ closeOnClick: true });
      pw.changeHeadline(headline);
      if (lines && lines.length) {
        pw.addLines(lines);
      }
      pw.show();
      pw.startCloseTimer(closeAfterMs || 0);
      return pw;
    }
    catch (e) {
      this._log(`进度窗失败：${e.message}`);
      return existing || null;
    }
  },

  _onProgress(params) {
    const stage = params.stage;
    if (stage === 'start') {
      this._addProgressLine(`▸ 处理 ${params.identifier || ''}`.trim());
      return;
    }
    if (stage === 'note') {
      if (params.message) {
        this._addProgressLine(`　${this._shortNote(params.message)}`);
      }
      return;
    }
    if (stage === 'done' && params.ok === false) {
      this._log(`后端报失败：${params.identifier} ${params.route || ''} exit=${params.exit_code}`);
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
      pw.addLines([text]);
      pw.show();
      this.pwLines++;
    }
    catch (e) {
      this._log(`进度窗加行失败：${e.message}`);
    }
  },

  _shortNote(msg) {
    const s = String(msg || '').replace(/\s+/g, ' ').trim();
    return s.length > 62 ? `${s.slice(0, 61)}…` : s;
  },

  _fail(e) {
    this._log(`未捕获：${e && e.stack ? e.stack : e}`);
    this._progress('lit-fetch：出错了（详见 Help→Debug Output / litfetch.log）', [], 8000);
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
