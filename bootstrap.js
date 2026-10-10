/* Zotero 7+ bootstrap 生命周期。形状与 zotero-reading-list / 官方 make-it-red 一致。

   这里自带一个极小的日志（不依赖插件里的东西）：startup 里任何一步炸掉，表现都是「插件像没装」
   ——菜单不出现、什么都没有。先落一行盘，再进主流程。 */

function _bootLog(msg) {
  try {
    const path = PathUtils.join(Zotero.DataDirectory.dir, 'litfetch.log');
    const line = `${new Date().toISOString()} [boot] ${msg}\n`;
    Zotero.File.getContentsAsync(path).then(
      (prev) => Zotero.File.putContentsAsync(path, prev + line),
      () => Zotero.File.putContentsAsync(path, line)
    ).catch(() => {});
  }
  catch (e) { /* 连日志都写不了就只剩 Zotero.debug */ }
}

function install(data, reason) {}
function uninstall(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  try {
    await Zotero.initializationPromise;

    if (!rootURI) {
      rootURI = resourceURI.spec; // Zotero 7 之前没有 rootURI
    }
    _bootLog(`startup 起 v${version} reason=${reason} rootURI=${rootURI}`);

    const ctx = { rootURI, pluginID: id, version };
    ctx._globalThis = ctx;
    Services.scriptloader.loadSubScript(rootURI + 'core.js', ctx); // 纯逻辑，可 node 自检
    _bootLog('core.js 载入 OK');
    Services.scriptloader.loadSubScript(rootURI + 'litfetch.js', ctx); // Zotero 侧
    _bootLog(`litfetch.js 载入 OK（Zotero.LitFetch=${typeof Zotero.LitFetch}）`);

    await Zotero.LitFetch.init({ rootURI, pluginID: id, version });
    _bootLog('init 正常返回');
  }
  catch (e) {
    _bootLog(`startup 失败：${e && e.stack ? e.stack : e}`);
  }
}

async function onMainWindowLoad({ window }, reason) {}
async function onMainWindowUnload({ window }, reason) {}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return; // 应用退出，Zotero 自己会清注册
  }
  if (typeof Zotero === 'undefined') {
    Zotero = Components.classes['@zotero.org/Zotero;1']
      .getService(Components.interfaces.nsISupports).wrappedJSObject;
  }
  // 必须收掉子进程：它会拖着一个 Edge 和一份浏览器 profile
  try {
    Zotero.LitFetch && Zotero.LitFetch.destroy();
  }
  catch (e) {
    _bootLog(`shutdown 清理失败：${e.message}`);
  }
}
