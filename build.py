"""打包 lit-fetch 插件并做静态自检。

用法: python build.py            # 自检 + 打包 xpi
产物: litfetch.xpi（manifest.json 在根）

自检四类：
  1. manifest 必填（applications.zotero 的 id / update_url / strict_max_version）—— 缺一项装不上，
     而 Zotero 只给一句笼统的“无法安装”，Firefox 的 linter 也查不出来
  2. 每个 .js 过一遍 node --check（语法）
  3. 脚本里没有 innerHTML/outerHTML 赋值（面板/片段类静默坑的通用防线）
  4. 脚本里用到的 l10nID 在 locale/*.ftl 里真的定义了（否则菜单项没字）
"""
from __future__ import annotations

import glob
import hashlib
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "litfetch.xpi"
FILES = ["manifest.json", "bootstrap.js", "litfetch.js", "core.js",
         "locale/en-US/litfetch.ftl", "locale/zh-CN/litfetch.ftl"]


def find_node() -> str | None:
    """本机 node 在 %LOCALAPPDATA%\\hermes\\tools\\node-*\\node.exe（skill 记录的位置）。"""
    cands = glob.glob(os.path.expandvars(r"%LOCALAPPDATA%\hermes\tools\node-*\node.exe"))
    cands += glob.glob(os.path.expandvars(r"%LOCALAPPDATA%\hermes\tools\node*\node.exe"))
    cands.sort(reverse=True)
    return cands[0] if cands else None


def _vt(s: str) -> tuple[int, ...]:
    return tuple(int(x) for x in re.findall(r"\d+", str(s))[:3]) or (0,)


def installed_zotero_version() -> str | None:
    ini = Path(r"C:\Program Files\Zotero\app\application.ini")
    if not ini.exists():
        return None
    for line in ini.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.strip().lower().startswith("version="):
            return line.split("=", 1)[1].strip()
    return None


def check_compat(m: dict) -> None:
    """本机 Zotero 必须落在 manifest 的 [strict_min_version, strict_max_version] 里。

    ponytail: Zotero 一升大版本，插件就变「不兼容」而只给一句笼统提示；这条把它变成打包时就报错。
    """
    z = m["applications"]["zotero"]
    lo, hi = z["strict_min_version"], z["strict_max_version"]
    app = installed_zotero_version()
    if not app:
        print("（没读到本机 Zotero 版本，跳过兼容性检查）")
        return
    assert _vt(app) >= _vt(lo), f"本机 Zotero {app} 低于 strict_min_version {lo}"
    if hi.endswith(".*"):
        assert app.startswith(hi[:-2]), (
            f"本机 Zotero {app} 不在 strict_max_version {hi} 覆盖内 —— 改 manifest 的 "
            f"strict_max_version 并顶一个版本号"
        )
    else:
        assert _vt(app) <= _vt(hi), f"本机 Zotero {app} 高于 strict_max_version {hi}"
    print(f"兼容 OK：本机 Zotero {app} ⊂ [{lo}, {hi}]")


def check_manifest() -> dict:
    m = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    z = m.get("applications", {}).get("zotero", {})
    for key in ("id", "update_url", "strict_max_version"):
        assert z.get(key), f"manifest 缺 applications.zotero.{key}"
    assert m.get("manifest_version") == 2, "manifest_version 必须是 2"
    print(f"manifest OK：{m['name']} {m['version']} → {z['id']}")
    return m


def check_js(node: str | None) -> None:
    js = sorted(HERE.glob("*.js"))
    assert js, "没找到 .js"
    for f in js:
        src = f.read_text(encoding="utf-8")
        assert not re.search(r"\b(?:inner|outer)HTML\s*=", src), f"{f.name} 里有 innerHTML/outerHTML 赋值"
        if node:
            r = subprocess.run([node, "--check", str(f)], capture_output=True, text=True)
            assert r.returncode == 0, f"node --check {f.name} 失败：{r.stderr.strip()[:200]}"
        else:
            print(f"  （没找到 node，跳过 {f.name} 的语法检查）")
    print(f"JS OK：{len(js)} 个文件语法通过、无 innerHTML 赋值" + ("" if node else "（node 缺席）"))


def check_l10n() -> None:
    used = set()
    for f in HERE.glob("*.js"):
        used |= set(re.findall(r"l10nID:\s*'([^']+)'", f.read_text(encoding="utf-8")))
    defined = set()
    for f in (HERE / "locale").glob("*/*.ftl"):
        defined |= set(re.findall(r"^([a-z0-9-]+)\s*=", f.read_text(encoding="utf-8"), re.M))
    missing = used - defined
    assert not missing, f"这些 l10nID 在 locale/*.ftl 里没有定义：{sorted(missing)}"
    print(f"l10n OK：用到 {sorted(used)}，定义 {sorted(defined)}")


def build() -> None:
    for rel in FILES:
        assert (HERE / rel).exists(), f"缺文件：{rel}"
    if OUT.exists():
        OUT.unlink()
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in FILES:
            z.write(HERE / rel, rel)
    with zipfile.ZipFile(OUT) as z:          # 回读：漏一个文件 = 装上没反应
        names = sorted(z.namelist())
        assert names == sorted(FILES), f"xpi 内容不符：{names}"
        json.loads(z.read("manifest.json"))   # 能解析
    data = OUT.read_bytes()
    print(f"打包 OK：{OUT.name} {len(data)}B sha256={hashlib.sha256(data).hexdigest()[:16]}…")
    print("  内容：" + ", ".join(names))


def main() -> int:
    node = find_node()
    m = check_manifest()
    check_compat(m)
    check_js(node)
    check_l10n()
    build()
    print("build.py: 全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
