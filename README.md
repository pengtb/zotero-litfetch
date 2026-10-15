# lit-fetch（Zotero 插件）

给条目补 PDF 全文：右键选中的条目 → 补 PDF（lit-fetch）。插件自己不下载，它调用本机的 **lit-fetch**
（两层：纯 HTTP 路线 + 真浏览器兜底），拿回 PDF 后作为附件挂到条目上。

依赖：本机要有 lit-fetch（`lit_fetch.py` + 它的 venv），路径在设置里配（见下）。没有 lit-fetch 时插件装得上，
但点菜单只会报「起不来」。

## 装

直接下最新的 `.xpi`（[releases/latest](https://github.com/pengtb/zotero-litfetch/releases/latest)），
或自己构建：`python build.py` 会做 manifest / 兼容性 / 语法 / 图标 / 设置面板 pref 对齐 / 文案键 /
面板 XML 良构这几组自检并打出 `litfetch.xpi`。

当前源码版本 **0.1.9**。0.1.7 起的变化：设置面板（抓取/语言/路径三段 9 项）+ 界面与日志语言（`lang`）+
付费墙开关（`paywall`），并修掉「pref 不带 `global=true` 所以所有设置都不生效」这个老 bug；
0.1.8 修设置面板接不上（初始化改走 xhtml 的 `onload`，函数挂 `Zotero` 上）；0.1.9 进度窗改成每篇换新。

1. Zotero → 工具 → 插件 → 齿轮 → Install Plugin From File… 选那个 `.xpi`（未签名提示选允许）。
2. 重启后：在条目上右键，菜单里出现「补 PDF（lit-fetch）」。

多选条目可一起跑；串行执行，一条失败不影响后面的。已有 PDF 附件的条目默认跳过。
进度窗每篇换一个：这一篇跑完、下一篇开始时上一个窗就关掉，所以窗里始终只有当前这篇的行；
全部跑完会另开一个干净的窗，把每篇的结果一行行列出来（15 秒后自动关）。

## 设置（编辑 → 设置 → lit-fetch）

设置面板里有 9 项，跟下面的 pref 一一对应（面板首次打开时会把没设过的 pref 补成缺口值，所以
配置编辑器里也能看到实际生效的值；面板文案跟着 `lang` 走）：

    extensions.litfetch.python       python 解释器（默认 lit-fetch 的 .venv/Scripts/python.exe；
                                     不存在则退回 PATH 上的 python）
    extensions.litfetch.script       lit_fetch.py 的绝对路径
    extensions.litfetch.outDir       下载临时目录（默认 <数据目录>/litfetch，挂上附件后删掉）
    extensions.litfetch.email        OA 接口用的联系邮箱
    extensions.litfetch.allowBrowser 是否允许走浏览器那层（默认 true）
    extensions.litfetch.paywall      付费刊要不要试一次出版商正文页（默认 true；关掉=只做开放获取）
                                     有机构 IP（校网/VPN）时才拿得到，见 lit-fetch 的 README
    extensions.litfetch.lang         界面与日志语言：auto|zh|en（默认 auto=跟 Zotero 界面语言）
    extensions.litfetch.timeoutS     单条超时秒数（默认 600）
    extensions.litfetch.skipExisting 已有 PDF 就跳过（默认 true）

也可以直接改配置编辑器（设置 → 高级 → 配置编辑器）里 `extensions.litfetch.*` 这些键，效果一样。
**读写 pref 必须带第二个参数 `true`**（`Zotero.Prefs.get(name, true)`）：不带时 Zotero 会在名字前加
`extensions.zotero.`，`extensions.litfetch.*` 永远读不到 —— 0.1.6 及以前就是这么写的，等于所有
设置都不生效，现已修掉。

`lang` 管插件自己的文案（菜单、进度窗、结果行、litfetch.log、设置面板）；后端 lit-fetch 推过来的诊断行
（`→ 试 unpaywall: …`）是它自己的输出，仍是中文。改这些设置立即生效，不用重启 Zotero。

日志：`<数据目录>/litfetch.log`，同时走 Zotero 的帮助 → 调试输出日志。

自检（改完 JS 跑一遍）：`node i18n.test.js`（文案 key 中英对齐 / 占位符一致 / resolve）、
`node litfetch.progress.test.js`（进度窗那三处坑：Zotero 7 的 `startCloseTimer` 单位是毫秒、加行前先
show、每篇换新窗要先 close 上一篇）、`node core.test.js`（纯逻辑）；
`python build.py` 另外查 manifest / 兼容性 / 语法 / 面板与 `_defaults()` 的 pref 对齐 / 文案键是否存在 /
面板 XML 良构，然后打包。

## 已知边界

- 每条只用一个标识符：DOI 优先，其次 arXiv，再次 PMID（Zotero 的 `extractIdentifiers` 就是这个顺序）。
  ISBN / adsBibcode 不认。条目没有任何标识符时会被跳过并在结果里标「无标识符」。
- 付费墙文献：默认会试一次出版商的正文页（`paywall`），有机构 IP（校网/VPN）时能拿到，拿不到就报
  「付费墙」；把 `paywall` 设成 false 就回到「只做开放获取」。
- 常驻子进程在插件卸载/停用时被杀；它自己会在 stdin 关闭（Zotero 退出）时退出。
  子进程会拉一个 Edge，所以别在它跑的时候手动清浏览器 profile。

## 开发

    node core.test.js              # 纯逻辑自检（标识符挑选 / 文件名 / 帧拆分）
    node i18n.test.js              # 文案表自检（zh/en key 对齐、占位符、语言解析）
    node litfetch.progress.test.js # 进度窗行为自检（Zotero 的 ProgressWindow 用 stub 顶掉）
    python probe_rpc.py            # 按插件真实发的帧敲 lit_fetch.py rpc，验证接口对得上
    python build.py                # 打包 + manifest/兼容性/语法/pref 对齐/文案键/面板 XML 自检

`bootstrap.js` 是生命周期（加载 core.js → i18n.js → litfetch.js），`core.js` 是纯逻辑（node 可跑），
`i18n.js` 是文案表（zh/en，60+ 条），`litfetch.js` 是 Zotero 侧（菜单、子进程、附件导入、进度窗），
`preferences.xhtml` + `preferences.js` 是设置面板（文案走 i18n，pref 绑定交给 Zotero 的 `preference` 机制）。

两个坑记在这（都是实测踩出来的，改面板/进度窗之前先读）:

- 面板脚本跑在 `Cu.Sandbox` 里，`var` 不会泄漏到窗口；而 xhtml 的内联事件属性按「元素所在窗口」的
  作用域求值 —— 所以初始化函数必须挂到 `Zotero.*` 上、用 `onload`/`oncommand` 调（本机
  better-bibtex / jasminum / custom-columns / reading-list 都是这么接的）。
- `Zotero.Prefs.get/set` 不带第二个参数 `true` 时会被加上 `extensions.zotero.` 前缀。
