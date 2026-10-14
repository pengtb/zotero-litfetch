/* lit-fetch 设置面板的脚本：在 Zotero 的设置窗口里跑（挂载见 litfetch.js 的 _registerPrefsPane）。
   两件事：
     1. 首次打开时把还没设过的 pref 补上缺口值 —— 不补的话面板里会显示成 false/空，和实际行为对不上
        （代码里的缺口值在 Zotero.LitFetch._defaults()，跟面板这两处必须一致，build.py 会查）。
     2. 按当前语言（pref `lang`）填文案：data-lf → textContent，data-lf-label → label 属性。

   ponytail: 不在 xhtml 里写 onload/oncommand。插件面板的脚本跑在 Cu.Sandbox 里（Zotero 的
   preferences.js：`pane.scope = new Cu.Sandbox(window, {sandboxPrototype: window})`），这些函数只存在
   于那个沙箱里，而内联事件属性按「元素所在窗口」的作用域求值 —— 属性里写 LitFetchPrefs.fill()
   会直接 ReferenceError。所以事件一律在这里 addEventListener：Zotero 插好面板后会给根节点派发一个
   load（我们挂在捕获阶段收），语言菜单挂 command。 */
var LitFetchPrefs = {
  PREFIX: 'extensions.litfetch.',
  ROOT: 'litfetch-prefpane',

  init() {
    try {
      this.materialize();
      const root = document.getElementById(this.ROOT);
      if (!root) {
        return;
      }
      const lang = root.querySelector('#litfetch-lang');
      if (lang) {
        lang.addEventListener('command', () => this.fill());   // 换语言立刻重填
      }
      this.fill();
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

// Zotero 插好面板后会给它的根节点派发 load；脚本比插面板先跑，所以捕获阶段挂在 window 上收得到
window.addEventListener('load', (event) => {
  if (event.target && event.target.id === LitFetchPrefs.ROOT) {
    LitFetchPrefs.init();
  }
}, true);
