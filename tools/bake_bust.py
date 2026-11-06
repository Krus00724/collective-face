"""Bake the bust data from MakeHuman's CC0 base mesh and expression targets.

Output: src/data/bustData.ts, holding the control cage of one shared bust topology, the rest
shape of each family member, all 34 expression units, face regions and a cylinder mapping
used by the wrinkle map.

Run:  python3 tools/bake_bust.py
Needs tools/data/base.obj and the targets folder, see README.
"""
import base64, json, os, sys
import numpy as np
sys.path.insert(0, 'tools')
import mh

KEEP = ('body', 'helper-upper-teeth', 'helper-lower-teeth', 'helper-tongue', 'helper-l-eye', 'helper-r-eye')
PART = {'body': 0, 'helper-upper-teeth': 1, 'helper-lower-teeth': 1, 'helper-tongue': 2, 'helper-l-eye': 3, 'helper-r-eye': 3}
UNIT = mh.TG + '/expression/units'


def cut_height(x):
    """The curved cut of a classical bust: low on the chest, rising over the shoulders."""
    return 3.86 + 0.62 * x * x


def main():
    base, faces, groups = mh.load_base()
    ref = mh.human({'female': .5, 'male': .5}, {'young': 1})
    shapes = {
        'mother': mh.human({'female': 1}, {'young': 1}),
        'father': mh.human({'male': 1}, {'young': 1}),
        'child': mh.human({'female': .5, 'male': .5}, {'young': .7, 'child': .3}),
    }

    # select faces, then keep what stays connected to the head
    sel, parts = [], []
    for f, g in zip(faces, groups):
        if g not in KEEP:
            continue
        if g == 'body' and ref[f, 1].mean() < cut_height(ref[f, 0].mean()):
            continue
        sel.append(f)
        parts.append(PART[g])
    n = len(ref)
    parent = np.arange(n)
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for f in sel:
        for v in f[1:]:
            parent[find(v)] = find(f[0])
    body_v = sorted({v for f, g in zip(faces, groups) if g == 'body' for v in f})
    mask = np.zeros(n, bool)
    mask[body_v] = True
    nose = int(np.argmax(ref[:, 2] * (ref[:, 1] > 6) * mask))
    head = find(nose)
    keepf = [(f, p) for f, p in zip(sel, parts) if p != 0 or find(f[0]) == head]
    used = sorted({v for f, _ in keepf for v in f})
    remap = -np.ones(n, dtype=np.int64)
    remap[used] = np.arange(len(used))
    F = [[int(remap[v]) for v in f] for f, _ in keepf]
    part = np.zeros(len(used), dtype=np.uint8)
    for f, p in zip(F, [p for _, p in keepf]):
        part[f] = p
    print('cage verts', len(used), 'faces', len(F))

    # boundary loops of the shell
    edges = {}
    for f in F:
        for a, b in zip(f, f[1:] + f[:1]):
            edges[(a, b)] = edges.get((a, b), 0) + 1
    nxt = {}
    for (a, b) in edges:
        if (b, a) not in edges:
            nxt[b] = a  # walk so the cap faces outward
    loops = []
    seen = set()
    for s in nxt:
        if s in seen:
            continue
        loop = [s]
        seen.add(s)
        c = nxt[s]
        while c != s and c not in seen:
            loop.append(c)
            seen.add(c)
            c = nxt.get(c, s)
        loops.append(loop)
    loops.sort(key=len, reverse=True)
    print('boundary loops', [len(l) for l in loops][:8])
    rim = loops[0]

    P = {k: v[used].copy() for k, v in shapes.items()}
    R = ref[used].copy()

    # the rim of the cut is a staircase of quad edges: relax it into one clean curve
    def relax(pos):
        arr = pos[rim].copy()
        for _ in range(40):
            arr = 0.5 * arr + 0.25 * (np.roll(arr, 1, 0) + np.roll(arr, -1, 0))
        pos[rim] = arr
    for pos in P.values():
        relax(pos)
    relax(R)

    # cap: rings stepping in from the rim, then a small fan, so the cut rolls over softly
    rings = [(0.965, -0.012), (0.88, 0.02), (0.68, 0.07), (0.4, 0.12)]
    base_n = len(used)
    F2 = list(F)
    prev = list(rim)
    for r in range(len(rings)):
        ring = [base_n + r * len(rim) + i for i in range(len(rim))]
        for i in range(len(rim)):
            j = (i + 1) % len(rim)
            F2.append([prev[i], prev[j], ring[j], ring[i]])
        prev = ring
    c = base_n + len(rings) * len(rim)
    F2 += [[prev[i], prev[(i + 1) % len(rim)], c] for i in range(len(rim))]
    part = np.append(part, np.zeros(len(rings) * len(rim) + 1, dtype=np.uint8))
    def with_cap(pos):
        m = pos[rim].mean(0)
        layers = [pos]
        for k, lift in rings:
            q = m + (pos[rim] - m) * k
            q[:, 1] += lift
            layers.append(q)
        layers.append((m + [0, 0.14, 0])[None])
        return np.vstack(layers)
    P = {k: with_cap(v) for k, v in P.items()}
    R = with_cap(R)
    used_map = {v: i for i, v in enumerate(used)}

    # expression units averaged across the three reference populations
    names = sorted(f[:-7] for f in os.listdir(UNIT + '/caucasian') if f.endswith('.target'))
    units = {}
    for name in names:
        acc = np.zeros((n, 3))
        for e in mh.ETH:
            i, d = mh.target(f'{UNIT}/{e}/{name}.target')
            acc[i] += d / 3
        u = acc[used]
        idx = np.nonzero(np.abs(u).sum(1) > 1e-4)[0]
        units[name] = (idx, u[idx])

    # regions in reference coordinates, decimetres
    L = lambda g: ref[sorted({v for f, gg in zip(faces, groups) if gg == g for v in f})].mean(0)
    eyeL, eyeR = L('helper-l-eye'), L('helper-r-eye')
    tip = ref[nose]
    top = ref[used, 1].max()
    mouth_i, mouth_d = mh.target(f'{UNIT}/caucasian/mouth-corner-puller.target')
    m = np.linalg.norm(mouth_d, axis=1)
    cl = mouth_i[np.argmax(m * (ref[mouth_i, 0] > 0))]
    cr = mouth_i[np.argmax(m * (ref[mouth_i, 0] < 0))]
    chin = ref[np.argmax(ref[:, 2] * (ref[:, 1] > 5.4) * (ref[:, 1] < tip[1] - 0.55) * (np.abs(ref[:, 0]) < 0.2) - 10 * (ref[:, 1] > ref[cl, 1] - 0.45))]
    land = {'eyeL': eyeL, 'eyeR': eyeR, 'nose': tip, 'mouthL': ref[cl], 'mouthR': ref[cr], 'chin': chin, 'top': np.array([0, top, 0.4])}
    print({k: np.round(v, 2).tolist() for k, v in land.items()})

    # cylinder mapping around the head for the wrinkle map
    zc = (eyeL[2] + R[:, 2].min()) * 0.5 if False else 0.42
    theta = np.arctan2(R[:, 0], R[:, 2] - zc)
    faceU = np.clip(theta / 2.2, -1, 1) * 0.5 + 0.5
    y0, y1 = 4.3, top + 0.1
    faceV = np.clip((R[:, 1] - y0) / (y1 - y0), 0, 1)

    q = lambda a: np.round(a * 2500).astype(np.int16)  # 0.04 mm steps at metre scale x 0.1
    b64 = lambda a: base64.b64encode(a.tobytes()).decode()

    quads = np.array([f for f in F2 if len(f) == 4], dtype=np.uint16).ravel()
    tris = np.array([f for f in F2 if len(f) == 3], dtype=np.uint16).ravel()
    unit_meta, unit_idx, unit_val = [], [], []
    for name in names:
        i, d = units[name]
        unit_meta.append([name, len(i)])
        unit_idx.append(i.astype(np.uint16))
        unit_val.append(np.round(d * 2500).astype(np.int16).ravel())
    meta = {
        'verts': len(R), 'landmarks': {k: np.round(v, 3).tolist() for k, v in land.items()},
        'units': unit_meta, 'wrinkle': {'y0': y0, 'y1': y1, 'range': 2.2, 'zc': zc},
    }
    ts = '/* Generated by tools/bake_bust.py. Do not edit. Source: MakeHuman base mesh and targets, CC0. */\n'
    ts += 'export const BUST_META = ' + json.dumps(meta, separators=(',', ':')) + ';\n'
    ts += f'export const QUADS = "{b64(quads)}";\nexport const TRIS = "{b64(tris)}";\n'
    ts += f'export const PART = "{b64(part)}";\n'
    for k in ('mother', 'father', 'child'):
        ts += f'export const REST_{k.upper()} = "{b64(q(P[k]))}";\n'
    ts += f'export const REF = "{b64(q(R))}";\n'
    ts += f'export const UNIT_IDX = "{b64(np.concatenate(unit_idx))}";\n'
    ts += f'export const UNIT_VAL = "{b64(np.concatenate(unit_val))}";\n'
    ts += f'export const FACE_U = "{b64(np.round(faceU * 65535).astype(np.uint16))}";\n'
    ts += f'export const FACE_V = "{b64(np.round(faceV * 65535).astype(np.uint16))}";\n'
    open('src/data/bustData.ts', 'w').write(ts)
    np.savez('tools/data/ref.npz', R=R, faceU=faceU, faceV=faceV, F=np.array([f + [-1] * (4 - len(f)) for f in F2]), land=json.dumps(meta['landmarks']))
    print('bustData.ts', len(ts) // 1024, 'KB')


main()
