"""生成插件图标（48 / 96 px PNG：一页纸 + 向下的箭头 = “把 PDF 取下来”）。
不用任何第三方库：按 PNG 规范直接写（zlib + struct），生成后回读校验。
用法: python make_icon.py
"""
import struct
import zlib

BASE = 48
BLUE = (0x2B, 0x6C, 0xB0)      # 纸的边和箭头
PAPER = (0xFF, 0xFF, 0xFF)     # 纸面
X0, X1 = 12, 36                # 纸的左右
Y0, Y1 = 4, 44                 # 纸的上下
FOLD_AT = 28                   # 右上角从这一列开始斜切（45°）
BORDER = 2                     # 边宽
SHAFT_X0, SHAFT_X1 = 20, 28    # 箭杆（以 24 为轴对称）
SHAFT_Y0, SHAFT_Y1 = 13, 28
HEAD_Y0, HEAD_Y1 = 28, 38      # 箭头三角：底 28、尖 38
HEAD_HALF = 8


def pixels(size):
    k = size / BASE

    def px(x, y):
        X, Y = (x + 0.5) / k, (y + 0.5) / k
        if not (X0 <= X < X1 and Y0 <= Y < Y1):
            return (0, 0, 0, 0)
        diag = Y - (Y0 + max(0.0, X - FOLD_AT))       # 折角那条 45° 线
        if X > FOLD_AT and diag < 0:
            return (0, 0, 0, 0)                        # 折掉的部分：留空
        if (X < X0 + BORDER or X >= X1 - BORDER or Y < Y0 + BORDER or Y >= Y1 - BORDER
                or (X > FOLD_AT and diag < BORDER)):
            return BLUE + (255,)                       # 纸的边（含斜边）
        if SHAFT_X0 <= X < SHAFT_X1 and SHAFT_Y0 <= Y < SHAFT_Y1:
            return BLUE + (255,)                       # 箭杆
        if HEAD_Y0 <= Y < HEAD_Y1:
            t = (Y - HEAD_Y0) / (HEAD_Y1 - HEAD_Y0)
            if abs(X - 24) <= HEAD_HALF * (1 - t):
                return BLUE + (255,)                   # 箭头
        return PAPER + (255,)

    return px


def write_png(path, size):
    fn = pixels(size)
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # 每行一个 filter type
        for x in range(size):
            raw.extend(fn(x, y))

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8bit RGBA
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))

    # 回读校验：magic + IHDR 尺寸 + IDAT 能解开且长度正好
    with open(path, "rb") as f:
        blob = f.read()
    assert blob[:8] == b"\x89PNG\r\n\x1a\n", "不是 PNG"
    w, h = struct.unpack(">II", blob[16:24])
    assert (w, h) == (size, size), f"尺寸不对 {(w, h)}"
    off = blob.index(b"IDAT") - 4
    n = struct.unpack(">I", blob[off:off + 4])[0]
    idat = blob[off + 8:off + 8 + n]
    assert len(zlib.decompress(idat)) == size * (1 + size * 4), "像素数据长度不对"


for name, size in (("icon.png", 48), ("icon@2x.png", 96)):
    write_png(name, size)
    print(f"已生成 {name} ({size}x{size})")

try:  # 有 PIL 就独立再验一遍
    from PIL import Image
    for name in ("icon.png", "icon@2x.png"):
        im = Image.open(name)
        im.load()
        print(f"  PIL 校验 {name}: {im.size} {im.mode}")
except ImportError:
    print("  （本机没有 PIL，跳过独立校验）")
