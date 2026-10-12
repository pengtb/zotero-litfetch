# lit-fetch（Zotero 插件）

给条目补 PDF 全文：右键选中的条目 → 补 PDF（lit-fetch）。插件自己不下载，它调用本机的 **lit-fetch**
（两层：纯 HTTP 路线 + 真浏览器兜底），拿回 PDF 后作为附件挂到条目上。

依赖：本机要有 lit-fetch（`lit_fetch.py` + 它的 venv），路径在设置里配（见下）。没有 lit-fetch 时插件装得上，
但点菜单只会报「起不来」。

## 装

1. `python build.py` 生成 `litfetch.xpi`（会自动做 manifest / 语法 / l10n 三组自检）。
2. Zotero → 工具 → 插件 → 齿轮 → Install Plugin From File… 选 `litfetch.xpi`，未签名提示选允许。
3. 重启后：在条目上右键，菜单里出现「补 PDF（lit-fetch）」。

多选条目可一起跑；串行执行，一条失败不影响后面的。已有 PDF 附件的条目默认跳过。

## 配置（设置 → 高级 → 配置编辑器）

插件不写默认 pref，读不到就用下面的缺口值，所以这些键**不设也能用**：

    extensions.litfetch.python       python 解释器（默认 lit-fetch 的 .venv/Scripts/python.exe；
                                     不存在则退回 PATH 上的 python）
    extensions.litfetch.script       lit_fetch.py 的绝对路径
    extensions.litfetch.outDir       下载临时目录（默认 <数据目录>/litfetch，挂上附件后删掉）
    extensions.litfetch.email        OA 接口用的联系邮箱
    extensions.litfetch.allowBrowser 是否允许走浏览器那层（默认 true）
    extensions.litfetch.timeoutS     单条超时秒数（默认 600）
    extensions.litfetch.skipExisting 已有 PDF 就跳过（默认 true）

日志：`<数据目录>/litfetch.log`，同时走 Zotero 的帮助 → 调试输出日志。

## 已知边界

- 每条只用一个标识符：DOI 优先，其次 arXiv，再次 PMID（Zotero 的 `extractIdentifiers` 就是这个顺序）。
  ISBN / adsBibcode 不认。条目没有任何标识符时会被跳过并在结果里标「无标识符」。
- 付费墙文献仍然拿不到（lit-fetch 只走 OA 路线），这点和工具的边界一致。
- 常驻子进程在插件卸载/停用时被杀；它自己会在 stdin 关闭（Zotero 退出）时退出。
  子进程会拉一个 Edge，所以别在它跑的时候手动清浏览器 profile。

## 开发

    node core.test.js          # 纯逻辑自检（标识符挑选 / 文件名 / 帧拆分）
    python probe_rpc.py        # 按插件真实发的帧敲 lit_fetch.py rpc，验证接口对得上
    python build.py            # 打包 + manifest/语法/l10n 自检

`core.js` 是纯逻辑（可以 node 跑），`litfetch.js` 是 Zotero 侧（菜单、子进程、附件导入），
`bootstrap.js` 是生命周期。
