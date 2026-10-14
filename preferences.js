/* lit-fetch 设置面板的脚本：在 Zotero 的设置窗口里跑（挂载见 litfetch.js 的 _registerPrefsPane）。
   两件事：
     1. 首次打开时把还没设过的 pref 补上缺口值 —— 不补的话输入框会显示 undefined（Zotero 的 pref 绑定把
        没设过的值 `String(undefined)` 塞进控件），跟实际行为也对不上。缺口值只有一份：
        Zotero.LitFetch._defaults()（跟面板必须一致，build.py 会查）。补完后 Zotero 自己的 pref observer
        会把真实值同步回控件（preferences.js 里的 registerObserver）。
     2. 按当前语言（pref `lang`）填文案：data-lf → textContent，data-lf-label → label 属性。

   ponytail: 必须挂在 Zotero.LitFetchPrefs 上、由 xhtml 的 onload/oncommand 调；别用
   window.addEventListener 去收 Zotero 派发的 load —— 插件面板的脚本跑在 Cu.Sandbox 里
   （preferences.js：`pane.scope = new Cu.Sandbox(window, {sandboxPrototype: window})`），沙箱里挂的监听
   收不到那次派发（实测：init 一次没跑，界面就是「文案空 → 错位 + 输入框 undefined」）。内联事件属性按
   「元素所在窗口」的作用域求值，函数得从窗口看得见 —— 所以挂在 Zotero 这个对象上（本机
   better-bibtex / jasminum / custom-columns / reading-list 全都这么接的）。 */
var LitFetchPrefs = {
  PREFIX: 'extensions.litfetch.',
  ROOT: 'litfetch-prefpane',

  init() {
    try {
      this.materialize();
      const root = document.getElementById(this.ROOT);
      if (root) {
        const lang = root.querySelector('#litfetch-lang');
        if (lang) {
          lang.addEventListener('command', () => this.fill());   // 换语言立刻重填
        }
      }
      this.fill();
      Zotero.LitFetch._log(Zotero.LitFetch._t('log.pane_init'));
    }
    catch (e) {
      Zotero.logError(e);
    }
  },

  materialize() {
    const defaults = Zotero.LitFetch._defaults();
    for (const key of Object.keys(defaults)) {
      const name = this.PREFIX + key;
      if (Zotero.Prefs.get(name, true) === undefined) {
        Zotero.Prefs.set(name, defaults[key], true);   // 类型由 Zotero 按值的类型自动建
      }
    }
  },

  fill() {
    const root = document.getElementById(this.ROOT);
    if (!root) {
      return;
    }
    const t = (key) => Zotero.LitFetch.t(key);
    for (const el of root.querySelectorAll('[data-lf],[data-lf-label]')) {
      if (el.hasAttribute('data-lf-label')) {
        el.setAttribute('label', t(el.getAttribute('data-lf-label')));
      }
      else {
        el.textContent = t(el.getAttribute('data-lf'));
      }
    }
  },
};

// 内联事件属性（xhtml 的 onload/oncommand）是按「元素所在窗口」的作用域求值的，所以函数要挂在
// 窗口看得见的对象上 —— 跟本机其它插件一样，挂到 Zotero 上（脚本本身跑在沙箱里，见顶部注释）。
Zotero.LitFetchPrefs = LitFetchPrefs;
try {
  Zotero.LitFetch._log(Zotero.LitFetch._t('log.pane_script'));
}
catch (e) {
  Zotero.logError(e);
}
