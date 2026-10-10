"""按插件实际发的帧去敲 lit_fetch.py rpc，验证接口对得上（不需要 Zotero）。
用法: python probe_rpc.py [identifier]   默认用一篇 arXiv（层的直链最稳）
产出: out/rpc-probe.pdf + 打印每个应答的关键字段（插件读的就是这些键）。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = Path(os.environ.get("LITFETCH_PYTHON",
                        r"C:\Users\ptbia\project\lit-fetch\.venv\Scripts\python.exe"))
SCRIPT = Path(os.environ.get("LITFETCH_SCRIPT",
                             r"C:\Users\ptbia\project\lit-fetch\lit_fetch.py"))
OUT = HERE / "out" / "rpc-probe.pdf"
IDENT = sys.argv[1] if len(sys.argv) > 1 else "arXiv:2610.04475"


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if OUT.exists():
        OUT.unlink()

    env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
    proc = subprocess.Popen([str(PY), str(SCRIPT), "rpc"], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                            encoding="utf-8", errors="replace", env=env, bufsize=1)

    def send(method: str, params: dict, rid: int) -> None:
        assert proc.stdin
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": rid, "method": method,
                                     "params": params}, ensure_ascii=False) + "\n")
        proc.stdin.flush()
        print(f"→ {method} id={rid} {json.dumps(params, ensure_ascii=False)[:120]}")

    def read_until(rid: int) -> dict:
        assert proc.stdout
        while True:
            line = proc.stdout.readline()
            if not line:
                raise SystemExit("后端提前关了 stdout（看上面 stderr）")
            msg = json.loads(line)
            if msg.get("method") == "progress":
                print(f"← progress {msg['params']}")
                continue
            if msg.get("id") == rid:
                return msg
            print(f"← 别的帧 id={msg.get('id')}")

    send("ping", {}, 1)
    pong = read_until(1)
    print("← ping:", pong.get("result"), pong.get("error"))

    send("fetch", {"identifier": IDENT, "out": str(OUT), "title": "",
                   "email": "ptbian@pku.edu.cn", "allow_browser": True}, 2)
    res = read_until(2)
    if res.get("error"):
        print("← fetch error:", res["error"])
        return 1
    env = res["result"]
    keys = ("ok", "route", "bytes", "path", "exit_code", "blocked_kind", "verdict")
    print("← fetch:", {k: env.get(k) for k in keys})
    missing = [k for k in ("ok", "path", "route", "bytes", "exit_code") if k not in env]
    ok = env.get("ok") is True and OUT.exists() and OUT.read_bytes()[:4] == b"%PDF"
    print(f"文件: {OUT} {'存在' if OUT.exists() else '不存在'}"
          + (f" {OUT.stat().st_size}B" if OUT.exists() else ""))
    print("插件读的键缺了:", missing or "无")
    print("probe_rpc:", "OK" if ok and not missing else "失败")
    send("shutdown", {}, 3)
    try:
        read_until(3)
    except SystemExit:
        pass
    try:
        proc.stdin.close()
    except Exception:
        pass
    proc.wait(timeout=10)
    return 0 if ok and not missing else 1


if __name__ == "__main__":
    sys.exit(main())
