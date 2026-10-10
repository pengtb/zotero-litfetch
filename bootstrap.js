/* Zotero 7+ bootstrap 生命周期。形状与 zotero-reading-list / 官方 make-it-red 一致。 */

function install(data, reason) {}
function uninstall(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  await Zotero.initializationPromise;

  if (!rootURI) {
    rootURI = resourceURI.spec; // Zotero 7 之前没有 rootURI
  }

  const ctx = { rootURI, pluginID: id, version };
  ctx._globalThis = ctx;
  Services.scriptloader.loadSubScript(rootURI + 'core.js', ctx); // 纯逻辑，可 node 自检
  Services.scriptloader.loadSubScript(rootURI + 'litfetch.js', ctx); // Zotero 侧

  await Zotero.LitFetch.init({ rootURI, pluginID: id, version });
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
  Zotero.LitFetch && Zotero.LitFetch.destroy();
}
