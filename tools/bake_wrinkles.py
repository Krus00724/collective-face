"""Draws the wrinkle map of the shared bust as real anatomical strokes.

Coordinates below are pixels of an unwrapped view of the head: x 450 is the centre of the face,
eyes sit at y 390, nose tip 525, mouth 610, chin 735, neck below 760. Strokes are mirrored.

Channels in the output: red, folds that appear when the skin is compressed by an expression;
green, lines of age that are always there.
"""
import base64
import numpy as np, cv2

S = 2048                      # output size
SS = 2                        # drawn at double size, then reduced
RECT = (0.16, 0.84, 0.24, 0.92)   # the part of the unwrap the map covers
rng = np.random.default_rng(7)

N = S * SS
fold = np.zeros((N, N), np.float32)
age = np.zeros((N, N), np.float32)


def to_px(x, y):
    u = (x + 250) / 1400
    v = 1 - y / 1400
    return (u - RECT[0]) / (RECT[1] - RECT[0]) * (N - 1), (1 - (v - RECT[2]) / (RECT[3] - RECT[2])) * (N - 1)


def spline(pts, step=0.45):
    p = np.array(pts, float)
    if len(p) == 2:
        p = np.vstack([p[0], (p[0] + p[1]) / 2, p[1]])
    q = np.vstack([2 * p[0] - p[1], p, 2 * p[-1] - p[-2]])
    out = []
    for i in range(1, len(q) - 2):
        n = max(4, int(np.linalg.norm(q[i + 1] - q[i]) / step))
        for t in np.linspace(0, 1, n, endpoint=False):
            a, b, c, d = q[i - 1], q[i], q[i + 1], q[i + 2]
            out.append(0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t ** 3))
    out.append(p[-1])
    return np.array(out)


def stroke(layer, pts, width, depth, mirror=True, wobble=0.9, taper=True):
    """A crease: a narrow valley between two slightly raised lips of skin."""
    for sign in ((1, -1) if mirror else (1,)):
        c = spline([(450 + sign * (x - 450), y) for x, y in pts])
        c = c + np.cumsum(rng.normal(0, wobble * 0.05, c.shape), 0) * 0.5
        px = np.array([to_px(x, y) for x, y in c])
        t = np.linspace(0, 1, len(px))
        w = width * SS * (np.sin(np.pi * t) ** 0.6 if taper else np.ones_like(t))
        x0, y0 = np.int32(px.min(0) - 60 * SS)
        x1, y1 = np.int32(px.max(0) + 60 * SS)
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(N, x1), min(N, y1)
        if x1 <= x0 or y1 <= y0:
            continue
        m = np.zeros((y1 - y0, x1 - x0), np.float32)
        for (a, b), wa, tt in zip(px, w, t):
            cv2.circle(m, (int((a - x0) * 8), int((b - y0) * 8)), max(1, int(wa * 8)), float(np.sin(np.pi * tt) ** 0.5 if taper else 1), -1, cv2.LINE_AA, 3)
        narrow = cv2.GaussianBlur(m, (0, 0), max(0.8, width * SS * 0.9))
        wide = cv2.GaussianBlur(m, (0, 0), max(2.0, width * SS * 3.4))
        pk1, pk2 = max(narrow.max(), 1e-3), max(wide.max(), 1e-3)
        layer[y0:y1, x0:x1] += -depth * narrow / pk1 + 0.34 * depth * wide / pk2


# Forehead: long, slightly arched, broken lines
for y0, reach, d in ((322, 170, 1), (293, 196, 1), (264, 208, .95), (236, 200, .75), (209, 165, .5)):
    for a, b in ((-1, -.62), (-.66, -.12), (-.18, .3), (.24, .72), (.66, 1)):
        xs = np.linspace(a, b, 5) * reach
        pts = [(450 + x, y0 + 12 * (x / reach) ** 2 - 7 * np.cos(x / reach * 2.6) + rng.normal(0, 1.4)) for x in xs]
        stroke(fold, pts, 1.5, d, mirror=False)
        stroke(age, pts, 0.9, 0.4 * d, mirror=False)

# Between the brows
stroke(fold, [(424, 338), (428, 362), (435, 392)], 1.8, 1.25)
stroke(fold, [(437, 348), (439, 368), (443, 388)], 1.2, 0.8)
stroke(age, [(424, 338), (428, 362), (435, 392)], 1.1, 0.45)
stroke(fold, [(430, 408), (450, 412), (470, 408)], 1.2, 0.7, mirror=False)
stroke(fold, [(434, 422), (450, 426), (466, 422)], 1.1, 0.6, mirror=False)

# Crow's feet, fanning from the outer corner of the eye
for end, d in (((248, 352), .8), ((238, 376), 1), ((236, 398), 1.1), ((244, 422), 1), ((262, 446), .8), ((284, 466), .55)):
    start = (300 + (end[0] - 240) * 0.1, 392 + (end[1] - 400) * 0.22)
    mid = ((start[0] + end[0]) / 2 + rng.normal(0, 2), (start[1] + end[1]) / 2 + rng.normal(0, 4))
    stroke(fold, [start, mid, end], 1.35, d)
    stroke(age, [start, mid, end], 0.8, 0.55 * d)

# Lids and under the eyes
stroke(age, [(300, 378), (330, 362), (365, 360), (392, 376)], 1.5, 0.75)
stroke(fold, [(302, 372), (345, 352), (392, 370)], 1.5, 0.9)
stroke(fold, [(312, 413), (345, 424), (386, 411)], 1.3, 0.8)
stroke(fold, [(300, 426), (345, 444), (394, 428)], 1.5, 0.9)
stroke(age, [(300, 426), (345, 444), (394, 428)], 1.2, 0.7)
stroke(age, [(290, 446), (345, 472), (402, 446)], 1.5, 0.55)
stroke(fold, [(286, 460), (340, 488), (392, 472)], 1.3, 0.45)

# Nose
for k, (a, b) in enumerate((((424, 440), (402, 458)), ((427, 454), (400, 476)), ((429, 468), (404, 490)))):
    stroke(fold, [a, ((a[0] + b[0]) / 2 + 2, (a[1] + b[1]) / 2 - 2), b], 1.15, 0.9 - k * .1)
stroke(age, [(398, 486), (390, 512), (402, 534)], 1.5, 0.85)
stroke(fold, [(398, 486), (390, 512), (402, 534)], 1.6, 0.7)

# Folds from the nose to the mouth, the deepest lines of the face
stroke(fold, [(394, 500), (374, 540), (358, 590), (350, 640)], 2.6, 1.7)
stroke(age, [(394, 500), (374, 540), (358, 590), (350, 640)], 2.0, 1.15)
stroke(fold, [(372, 500), (344, 556), (330, 620), (332, 668)], 1.7, 0.75)
stroke(fold, [(350, 500), (316, 560), (306, 640)], 1.4, 0.4)
stroke(fold, [(330, 530), (296, 590), (296, 650)], 1.3, 0.35)

# Lines from the corners of the mouth down
stroke(fold, [(370, 622), (362, 660), (372, 704)], 1.8, 1.05)
stroke(age, [(370, 622), (362, 660), (372, 704)], 1.5, 0.8)
stroke(age, [(352, 648), (344, 690), (352, 722)], 1.2, 0.45)
stroke(fold, [(372, 596), (364, 612), (366, 628)], 1.5, 0.9)

# Around the lips
for x in np.arange(388, 450, 9.0):
    top = 584 - (x - 388) * 0.04 + rng.normal(0, 1.5)
    stroke(fold, [(x, top), (x + rng.normal(0, 1), top + 22 + rng.normal(0, 3))], 0.9, 0.7)
    stroke(fold, [(x, 620 + rng.normal(0, 2)), (x + rng.normal(0, 1.5), 646 + rng.normal(0, 3))], 0.9, 0.7)
    stroke(age, [(x, top + 2), (x + rng.normal(0, 1), top + 18)], 0.7, 0.4)
    stroke(age, [(x, 622), (x, 642)], 0.7, 0.4)
for x in np.arange(396, 450, 13.0):
    stroke(age, [(x, 552 + rng.normal(0, 3)), (x - (450 - x) * .05, 576)], 0.8, 0.4)
    stroke(age, [(x, 654), (x - (450 - x) * .06, 672 + rng.normal(0, 3))], 0.8, 0.35)

# Chin
stroke(fold, [(402, 664), (450, 676), (498, 664)], 1.8, 1.0, mirror=False)
stroke(age, [(402, 664), (450, 676), (498, 664)], 1.4, 0.6, mirror=False)
stroke(age, [(450, 696), (450, 712)], 1.6, 0.5, mirror=False)

# Neck rings
for y0, d in ((800, .7), (850, .85), (900, .6)):
    xs = np.linspace(-1, 1, 9) * 262
    pts = [(450 + x, y0 + 24 * (x / 262) ** 2 + rng.normal(0, 1)) for x in xs]
    stroke(age, pts, 1.7, 0.55 * d, mirror=False)
    stroke(fold, pts, 2.2, 0.8 * d, mirror=False)

# Fine crepe all over: thousands of tiny lines that follow the direction of the skin
fine_mask = np.zeros((N, N), np.float32)
pores = np.zeros((N, N), np.float32)
ex, ey = 300, 392
for _ in range(26000):
    x = rng.uniform(170, 730)
    y = rng.uniform(190, 980)
    dx = abs(x - 450)
    if y < 345:
        ang = rng.normal(0, .14)
    elif y < 500 and dx > 90:
        ang = np.arctan2(y - ey, abs(x - 450) - 150) * (1 if x > 450 else -1) * 1 + rng.normal(0, .25)
    elif y < 760:
        ang = (np.pi / 2 - .35 * (1 if x > 450 else -1)) + rng.normal(0, .3)
    else:
        ang = rng.normal(0, .2)
    if rng.random() < .28:
        ang += np.pi / 2
    L = rng.uniform(4, 13)
    a = to_px(x - np.cos(ang) * L, y - np.sin(ang) * L)
    b = to_px(x + np.cos(ang) * L, y + np.sin(ang) * L)
    cv2.line(fine_mask, (int(a[0]), int(a[1])), (int(b[0]), int(b[1])), float(rng.uniform(.3, 1)), 1, cv2.LINE_AA)
for _ in range(38000):
    x = rng.uniform(250, 650)
    y = rng.uniform(330, 720)
    a = to_px(x, y)
    cv2.circle(pores, (int(a[0]), int(a[1])), 1 if rng.random() < .7 else 2, float(rng.uniform(.4, 1)), -1, cv2.LINE_AA)

fine = cv2.GaussianBlur(fine_mask, (0, 0), 1.1 * SS * .5)
age -= fine * 0.42
pore = cv2.GaussianBlur(pores, (0, 0), 0.6 * SS)
age -= pore * 0.38

# eyes, lips and nostrils stay clean: wrinkles belong to skin, not to the openings
def hole(cx, cy, rx, ry):
    a = to_px(cx, cy)
    sx = (N / ((RECT[1] - RECT[0]) * 1400))
    Y, X = np.ogrid[:N, :N]
    return np.exp(-(((X - a[0]) / (rx * sx)) ** 2 + ((Y - a[1]) / (ry * sx)) ** 2) ** 2)

clean = np.ones((N, N), np.float32)
for sgn in (-1, 1):
    clean *= 1 - hole(450 + sgn * 105, 390, 46, 16).astype(np.float32)
fold *= clean
age *= clean

rx = cv2.resize(fold, (S, S), interpolation=cv2.INTER_AREA)
ag = cv2.resize(age, (S, S), interpolation=cv2.INTER_AREA)
to8 = lambda a: np.clip(128 + a * 92, 0, 255).astype(np.uint8)
img = np.dstack([np.full((S, S), 128, np.uint8), to8(ag), to8(rx)])  # BGR order: B unused, G age, R fold
ok, buf = cv2.imencode('.webp', img, [cv2.IMWRITE_WEBP_QUALITY, 90])
ts = '/* Generated by tools/bake_wrinkles.py. Do not edit. */\n'
ts += f'export const WRINKLE_RECT = {list(RECT)};\n'
ts += f'export const WRINKLES = "data:image/webp;base64,{base64.b64encode(buf.tobytes()).decode()}";\n'
open('src/data/wrinkles.ts', 'w').write(ts)
print('wrinkles', len(buf) // 1024, 'KB')
cv2.imwrite('tools/data/wrinkle_preview.png', cv2.resize(np.dstack([to8(rx), to8(ag), to8(rx)]), (1024, 1024)))
