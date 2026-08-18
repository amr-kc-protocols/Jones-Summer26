"""Render the Drop In app icon — run this, not an image editor.

 Pure stdlib: signed-distance shapes,
4x supersampled, written out as PNG by hand."""
import zlib, struct, math, os

NAVY  = (0x10, 0x1a, 0x2e)
COBALT= (0x4d, 0x7c, 0xe8)
PALE  = (0xe8, 0xef, 0xfd)
LIVE  = (0xe2, 0x43, 0x4c)

def sd_round_rect(px, py, cx, cy, hx, hy, r):
    dx = abs(px - cx) - (hx - r)
    dy = abs(py - cy) - (hy - r)
    ax, ay = max(dx, 0.0), max(dy, 0.0)
    return math.hypot(ax, ay) + min(max(dx, dy), 0.0) - r

def sd_circle(px, py, cx, cy, r):
    return math.hypot(px - cx, py - cy) - r

def shade(x, y, s):
    """x,y in [0,1]. s scales the artwork about the centre (for maskable).
    Returns (r,g,b,a) or None for transparent."""
    px = (x - 0.5) / s + 0.5
    py = (y - 0.5) / s + 0.5

    body = sd_round_rect(px, py, 0.500, 0.550, 0.300, 0.210, 0.058)
    hump = sd_round_rect(px, py, 0.500, 0.330, 0.108, 0.048, 0.030)
    shell = min(body, hump)

    stroke = 0.023                                   # half-width
    if abs(shell) < stroke:  return COBALT + (255,)

    lens_out = sd_circle(px, py, 0.500, 0.560, 0.116)
    if abs(lens_out) < stroke: return COBALT + (255,)
    if sd_circle(px, py, 0.500, 0.560, 0.048) < 0: return PALE + (255,)

    if sd_circle(px, py, 0.712, 0.452, 0.030) < 0: return LIVE + (255,)

    if shell < 0: return None                        # inside the camera body
    return None

def render(size, maskable=False, opaque=False):
    ss = 4
    scale = 0.78 if maskable else 1.0
    bg_r = 0.5 if (maskable or opaque) else 0.0      # 0 => rounded plate
    plate_r = 0.215
    px = bytearray()
    for j in range(size):
        row = bytearray()
        for i in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sj in range(ss):
                for si in range(ss):
                    x = (i + (si + 0.5) / ss) / size
                    y = (j + (sj + 0.5) / ss) / size
                    if maskable or opaque:
                        inside_plate = True
                    else:
                        inside_plate = sd_round_rect(x, y, 0.5, 0.5, 0.5, 0.5, plate_r) < 0
                    if not inside_plate:
                        continue
                    c = shade(x, y, scale)
                    r, g, b = c[:3] if c else NAVY
                    acc[0] += r; acc[1] += g; acc[2] += b; acc[3] += 255
            n = ss * ss
            a = acc[3] / n
            if a < 0.5:
                row += bytes((0, 0, 0, 0))
            else:
                # un-premultiply the coverage so edges keep their colour
                k = acc[3] / 255.0
                row += bytes((round(acc[0] / k), round(acc[1] / k), round(acc[2] / k), round(a)))
        px += b'\x00' + row
    return bytes(px)

def write_png(path, size, data):
    def chunk(tag, payload):
        return (struct.pack('>I', len(payload)) + tag + payload +
                struct.pack('>I', zlib.crc32(tag + payload) & 0xffffffff))
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    out = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) +
           chunk(b'IDAT', zlib.compress(data, 9)) + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(out)

# Writes beside itself unless told otherwise:  OUT=… python3 render.py
out = os.environ.get('OUT', os.path.dirname(os.path.abspath(__file__)))
jobs = [
    ('icon-192.png', 192, False, False),
    ('icon-512.png', 512, False, False),
    ('icon-512-maskable.png', 512, True, False),
    ('apple-touch-icon.png', 180, False, True),
]
for name, size, maskable, opaque in jobs:
    write_png(os.path.join(out, name), size, render(size, maskable, opaque))
    print(name, size)
