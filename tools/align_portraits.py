"""Brings the studio portraits onto one face.

Each portrait has its eyes, nose and mouth somewhere else, so a piece cut from one lands in the wrong
place on another. Landmarks are found on all of them, averaged into one template, and each portrait
is bent smoothly onto it. After this an eye sits where an eye sits, in every portrait.

The same template gives the ready made cuts, and the three points a visitor's own photo is fitted to.

Run: python3 tools/align_portraits.py <landmarks.json from tools/mp/landmarks.cjs>
"""
import json, sys
import numpy as np
import cv2
from scipy.interpolate import RBFInterpolator

S = 512
SCALE = 360 / S
rec = json.load(open(sys.argv[1]))
L = np.array([np.array(r['landmarks'])[:468, :2] * [r['w'], r['h']] for r in rec])

EYE_R = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466]
EYE_L = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
BROW_L = [70, 63, 105, 66, 107, 46, 53, 52, 65, 55]
BROW_R = [300, 293, 334, 296, 336, 276, 283, 282, 295, 285]
LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185]
LIPS_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191]
NOSE = [168, 6, 197, 195, 5, 4, 1, 2, 98, 327, 129, 358, 49, 279, 64, 294, 94, 19]
JAW = [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454]
TOP = [127, 162, 21, 54, 103, 67, 109, 10, 338, 297, 332, 284, 251, 389, 356]
STABLE = [33, 133, 362, 263, 168, 1, 2, 61, 291, 13, 152]
KEY = sorted(set(EYE_L + EYE_R + BROW_L + BROW_R + LIPS + LIPS_IN + NOSE + JAW + TOP))


def fit(a, b):
    """Scale, turn and shift that take a onto b."""
    ca, cb = a.mean(0), b.mean(0)
    p, q = a - ca, b - cb
    h = (p[:, 0] + 1j * p[:, 1]).conj() @ (q[:, 0] + 1j * q[:, 1])
    z = h / (np.abs(p) ** 2).sum()
    return z, ca, cb


def move(pts, z, ca, cb):
    c = (pts[:, 0] - ca[0]) + 1j * (pts[:, 1] - ca[1])
    c = c * z
    return np.c_[c.real + cb[0], c.imag + cb[1]]


# the template: all six laid over each other, then averaged
ref = L[0]
for _ in range(3):
    laid = np.array([move(l, *fit(l[STABLE], ref[STABLE])) for l in L])
    ref = laid.mean(0)
# a touch to the left or right and up or down, so the face stands in the middle of the square
ref = ref + [S / 2 - ref[[33, 263], 0].mean(), 212 - ref[[33, 133, 362, 263], 1].mean()]


edge = np.array([[x, y] for x in np.linspace(0, S - 1, 9) for y in (0, S - 1)] + [[x, y] for y in np.linspace(0, S - 1, 9)[1:-1] for x in (0, S - 1)], float)
G = 96
gx, gy = np.meshgrid(np.linspace(0, S - 1, G), np.linspace(0, S - 1, G))
grid = np.c_[gx.ravel(), gy.ravel()]

for i, l in enumerate(L):
    src = cv2.imread(f'tools/data/portraits_src/{i + 1}.jpg')
    # far from the face a portrait simply moves as a whole
    z, ca, cb = fit(ref[STABLE], l[STABLE])
    anchors = move(edge, z, ca, cb)
    tgt = np.vstack([ref[KEY], edge])
    frm = np.vstack([l[KEY], anchors])
    back = RBFInterpolator(tgt, frm, kernel='thin_plate_spline', smoothing=2.0)(grid).reshape(G, G, 2).astype(np.float32)
    mapx = cv2.resize(back[:, :, 0], (S, S), interpolation=cv2.INTER_CUBIC)
    mapy = cv2.resize(back[:, :, 1], (S, S), interpolation=cv2.INTER_CUBIC)
    out = cv2.remap(src, mapx, mapy, cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT_101)
    # where the bend reaches past the photo there is only backdrop, except below, where shoulders run on
    off = ((mapy < 0) | (mapx < 0) | (mapx > S - 1)).astype(np.float32)
    off = cv2.GaussianBlur(off, (0, 0), 3)[:, :, None]
    paper = np.median(np.vstack([src[:8, :8].reshape(-1, 3), src[:8, -8:].reshape(-1, 3)]), axis=0)
    out = (out * (1 - off) + paper * off).clip(0, 255).astype(np.uint8)
    cv2.imwrite(f'src/assets/portraits/{i + 1}.jpg', out, [cv2.IMWRITE_JPEG_QUALITY, 90])


def outline(points, grow, n=26):
    """A soft closed shape around these points, in canvas units."""
    m = np.zeros((720, 720), np.uint8)
    hull = cv2.convexHull(np.round(np.array(points) * SCALE * 2).astype(np.int32))
    cv2.fillConvexPoly(m, hull, 255)
    k = int(grow * 2) * 2 + 1
    m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    c = max(cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0], key=len)[:, 0, :].astype(float) / 2
    step = np.linspace(0, len(c), n, endpoint=False).astype(int)
    return [{'x': round(float(a), 1), 'y': round(float(b), 1)} for a, b in c[step]]


cuts = {
    'Forehead': outline(ref[[109, 10, 338, 67, 297, 105, 334, 107, 336, 9]], 3),
    'Brows': outline(ref[BROW_L + BROW_R], 5),
    'Eyes': outline(ref[EYE_L + EYE_R], 8),
    'Nose': outline(ref[NOSE], 5),
    'Mouth': outline(ref[LIPS], 7),
    'Chin': outline(ref[[148, 176, 149, 152, 377, 400, 378, 84, 17, 314, 18, 83, 313]], 5),
}
anchor = {
    'left': [float(x) * SCALE for x in ref[[33, 133]].mean(0)],
    'right': [float(x) * SCALE for x in ref[[362, 263]].mean(0)],
    'mouth': [float(x) * SCALE for x in ref[[13, 14]].mean(0)],
}
open('src/studio/template.ts', 'w').write(
    '/* Generated by tools/align_portraits.py. Do not edit. */\n'
    f'export const CUTS: Record<string, {{ x: number; y: number }}[]> = {json.dumps(cuts, separators=(",", ":"))};\n'
    f'export const ANCHOR = {json.dumps(anchor, separators=(",", ":"))};\n'
    f'/** Landmark numbers and where they sit on the template, in a 512 pixel square. */\n'
    f'export const FIT = {json.dumps({"key": KEY, "points": [[round(float(a), 1), round(float(b), 1)] for a, b in ref[KEY]]}, separators=(",", ":"))};\n')
print('template eye y', round(float(ref[[33, 133, 362, 263], 1].mean())), 'mouth y', round(float(ref[13, 1])), 'chin y', round(float(ref[152, 1])))
