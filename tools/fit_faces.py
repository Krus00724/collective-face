"""Fits the three busts to the friends' photographs.

Face landmarks (MediaPipe, 478 points) are found both on the photo and on a render of the base head,
so every landmark has a known place on the mesh. The photo is corrected for selfie distance and
aligned to the head. The difference at the landmarks then becomes a smooth bend of the whole surface,
solved along the skin itself: lips and lids stay separate, and nothing is left at a hard edge.

The photographs are not stored in the work. Only the resulting shape is.

Run: python3 tools/fit_faces.py <scratch dir with photos.json, renders.json, base renders>
"""
import base64, json, re, sys
import numpy as np
import scipy.sparse as sparse
from scipy.sparse.linalg import factorized
from scipy.spatial import cKDTree

SP = sys.argv[1]
TS = 'src/data/bustData.ts'
FIGS = ('mother', 'father', 'child')
# which photo feeds which bust, and the assumed camera distance in centimetres
SOURCE = {'mother': (0, 130), 'father': (1, 130), 'child': (3, 130)}
# a likeness reads better when what sets a face apart is pushed a little further
CHARACTER = {'mother': 1.12, 'father': 1.12, 'child': 1.12}
Z_TRUST = {'mother': 0.45, 'father': 0.45, 'child': 0.45}
# how far each face is pulled towards its own mirror image
SYMMETRY = {'mother': 0.6, 'father': 0.5, 'child': 0.5}
BEND, STRETCH, HOLD = 0.3, 0.01, 0.0004
# base lids sit wide open and read as a stare on a young face
LIDS = {'mother': 0.1, 'father': 0.16, 'child': 0.1}

src = open(TS).read()
def const(name):
    return re.search(rf'export const {name} = "([^"]+)"', src).group(1)
u16 = lambda s: np.frombuffer(base64.b64decode(s), np.uint16)

part = np.frombuffer(base64.b64decode(const('PART')), np.uint8)
photos = json.load(open(f'{SP}/photos.json'))
renders = json.load(open(f'{SP}/renders.json'))

LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185]
LIPS_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191]
EYE = {1: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
       -1: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]}
NOSE = [1, 2, 4, 5, 6, 19, 94, 97, 98, 168, 195, 197, 326, 327, 328, 99, 240, 460, 64, 294, 48, 278, 49, 279, 129, 358, 102, 331, 75, 305]
OVAL = [338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
        148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10]
UPPER = [10, 151, 9, 8, 107, 66, 105, 63, 70, 336, 296, 334, 293, 300, 108, 69, 104, 68, 71, 337, 299, 333, 298, 301]
STABLE = [33, 133, 362, 263, 168, 6, 197, 195, 5, 4, 1, 2, 61, 291, 13, 152]

def to3d(rec):
    l = np.array(rec['landmarks'], float)
    return np.c_[l[:, 0] * rec['w'], -l[:, 1] * rec['h'], -l[:, 2] * rec['w']]

def undistort(L, cm):
    """Removes most of the selfie lens effect: near features are drawn too large."""
    width = np.linalg.norm(L[234, :2] - L[454, :2])
    d = cm * width / 14.0
    plane = 0.5 * (L[234, 2] + L[454, 2])
    c = L[:468, :2].mean(0)
    k = (d - (L[:, 2] - plane)) / d
    out = L.copy()
    out[:, :2] = c + (L[:, :2] - c) * k[:, None]
    return out

def similarity(A, B, w):
    """s, R, t so that s R A + t fits B."""
    w = w[:, None] / w.sum()
    ca, cb = (A * w).sum(0), (B * w).sum(0)
    H = ((A - ca) * w).T @ (B - cb)
    U, S, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    R = Vt.T @ np.diag([1, 1, d]) @ U.T
    s = (S * [1, 1, d]).sum() / (((A - ca) ** 2) * w).sum()
    return s, R, cb - s * R @ ca

meta = json.loads(re.search(r'export const BUST_META = (\{.*?\});\n', src, re.S).group(1))
all_i = u16(const('UNIT_IDX'))
all_v = np.frombuffer(base64.b64decode(const('UNIT_VAL')), np.int16).reshape(-1, 3) * (0.1 / 2500)
closure, at = {}, 0
for unit, count in meta['units']:
    closure[unit] = (all_i[at:at + count], all_v[at:at + count])
    at += count

quads = u16(const('QUADS')).reshape(-1, 4)
tris = u16(const('TRIS')).reshape(-1, 3)
n = len(part)
ii, jj = [], []
for f in list(quads) + list(tris):
    for a, b in zip(f, list(f[1:]) + [f[0]]):
        if part[a] == 0 and part[b] == 0:
            ii += [a, b]; jj += [b, a]
A = sparse.csr_matrix((np.ones(len(ii)), (ii, jj)), shape=(n, n))
A.data[:] = 1
deg = np.asarray(A.sum(1)).ravel()
L = sparse.identity(n, format='csr') - sparse.diags(1 / np.maximum(deg, 1)) @ A
L = sparse.diags((deg > 0).astype(float)) @ L
body = np.nonzero((part == 0) & (deg > 0))[0]
tree_ids = body

for fi, fig in enumerate(FIGS):
    name = 'REST_' + fig.upper()
    rest = np.load(f'tools/data/base_{fig}.npy')
    ids = np.fromfile(f'{SP}/{fig}.id.bin', np.int32).reshape(1024, 1024)
    dense = np.fromfile(f'{SP}/{fig}.pos.bin', np.float32).reshape(-1, 3).astype(np.float64)
    lr = np.array(renders[fi]['landmarks'], float)
    px = np.clip((lr[:, :2] * 1024).astype(int), 0, 1023)
    S = np.zeros((478, 3))
    ok = np.zeros(478, bool)
    for i, (x, y) in enumerate(px):
        win = ids[max(0, y - 3):y + 4, max(0, x - 3):x + 4]
        v = win[win >= 0]
        if v.size:
            S[i] = dense[np.bincount(v).argmax()]
            ok[i] = True
    ok[468:] = False

    idx, cm = SOURCE[fig]
    P = undistort(to3d(photos[idx]), cm)
    s_, R, t = similarity(P[STABLE], S[STABLE], np.ones(len(STABLE)))
    T = (s_ * (R @ P.T)).T + t
    D = T - S
    D[:, 2] -= D[:468, 2].mean()
    D[:, 2] *= Z_TRUST[fig]

    mir = S[:468].copy(); mir[:, 0] *= -1
    pair = cKDTree(S[:468]).query(mir)[1]
    Dm = D[:468][pair].copy(); Dm[:, 0] *= -1
    k = SYMMETRY[fig]
    D[:468] = (1 - k) * D[:468] + k * 0.5 * (D[:468] + Dm)
    # hair hides the sides of the jaw in the photo: both sides share one reading
    D[OVAL] = 0.5 * (D[:468] + Dm)[OVAL]
    D *= CHARACTER[fig]

    # landmark weights
    w = np.full(478, 0.25)
    w[NOSE] = 1; w[LIPS] = 1.2; w[LIPS_IN] = 0.5
    w[EYE[1]] = 1; w[EYE[-1]] = 1
    w[OVAL] = 1; w[UPPER] = 0.02
    w[[33, 133, 362, 263, 61, 291]] = 2.5
    if fig == 'child':
        # a hat covers the top of this face: the outline above the eyes is a guess
        w[[o for o in OVAL if S[o, 1] > S[33, 1]]] = 0.05
    w[~ok] = 0

    # each landmark reads the four nearest vertices of the cage
    tree = cKDTree(rest[tree_ids])
    use = np.nonzero(w[:468] > 0)[0]
    dist, near_i = tree.query(S[use], k=3)
    g = np.exp(-(dist / 0.003) ** 2) + 1e-6
    g /= g.sum(1, keepdims=True)
    rows = np.repeat(np.arange(len(use)), 3)
    B = sparse.csr_matrix((g.ravel(), (rows, tree_ids[near_i].ravel())), shape=(len(use), n))
    W = sparse.diags(w[use])
    chin = S[152, 1]
    fixed = np.nonzero((part == 0) & (rest[:, 1] < chin - 0.075))[0]
    hold = np.zeros(n); hold[fixed] = 0.6
    M = (B.T @ W @ B) + BEND * (L.T @ L) + STRETCH * (L + L.T) * 0.5 + sparse.diags(hold + HOLD)
    solve = factorized(M.tocsc())
    rhs = B.T @ W @ D[use]
    U = np.stack([solve(rhs[:, c]) for c in range(3)], 1)
    U[part != 0] = 0

    out = rest + U
    # eyes, teeth and tongue travel as solid objects, with the lids and lips around them
    lid = lambda side: tree_ids[tree.query(S[EYE[side]])[1]]
    for side in (1, -1):
        m = (part == 3) & (np.sign(rest[:, 0]) == side)
        out[m] = rest[m] + U[lid(side)].mean(0)
    m = (part == 1) | (part == 2)
    out[m] = rest[m] + U[tree_ids[tree.query(S[LIPS])[1]]].mean(0)

    for unit in ('eye-left-closure', 'eye-right-closure'):
        i, v = closure[unit]
        out[i] += v * LIDS[fig]

    fitted = B @ U
    def ratios(Q):
        ipd = np.linalg.norm(Q[[33, 133]].mean(0) - Q[[362, 263]].mean(0))
        ey = Q[[33, 133, 362, 263], 1].mean()
        return ' '.join(f'{k} {v:.2f}' for k, v in dict(nose=(ey - Q[2, 1]) / ipd, lip=(ey - Q[13, 1]) / ipd, chin=(ey - Q[152, 1]) / ipd,
            mouthW=abs(Q[61, 0] - Q[291, 0]) / ipd, noseW=abs(Q[98, 0] - Q[327, 0]) / ipd, jawW=abs(Q[172, 0] - Q[397, 0]) / ipd,
            faceW=abs(Q[234, 0] - Q[454, 0]) / ipd, eyeW=abs(Q[33, 0] - Q[133, 0]) / ipd, lipH=abs(Q[0, 1] - Q[17, 1]) / ipd, ipdmm=ipd * 1000).items())
    Q = S.copy(); Q[use] += fitted
    print('  base  ', ratios(S)); print('  target', ratios(S + D)); print('  fitted', ratios(Q))
    print(fig, 'photo rms mm', round(float(np.sqrt((D[:468] ** 2).sum(1).mean())) * 1000, 1),
          'after fit rms mm', round(float(np.sqrt(((fitted - D[use]) ** 2).sum(1).mean())) * 1000, 2),
          'max moved mm', round(float(np.linalg.norm(U, axis=1).max()) * 1000, 1))
    q = np.round(out * (2500 / 0.1)).astype(np.int16)
    src = re.sub(rf'export const {name} = "[^"]+"', f'export const {name} = "{base64.b64encode(q.tobytes()).decode()}"', src)
    out.astype(np.float32).tofile(f'{SP}/{fig}.fit.bin')

open(TS, 'w').write(src)
