"""Shared helpers: read the MakeHuman base mesh and targets (assets are CC0)."""
import numpy as np, os
ROOT = 'tools/data'
TG = ROOT + '/mh/repo/makehuman/data/targets'

def load_base():
    V, faces, groups = [], [], []
    g = None
    for line in open(ROOT + '/base.obj'):
        if line.startswith('v '):
            V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('g '):
            g = line.split()[1]
        elif line.startswith('f '):
            faces.append([int(c.split('/')[0]) - 1 for c in line.split()[1:]])
            groups.append(g)
    return np.array(V), faces, groups

def target(path):
    idx, d = [], []
    for line in open(path):
        if line.startswith('#') or not line.strip():
            continue
        p = line.split()
        idx.append(int(p[0]))
        d.append([float(x) for x in p[1:4]])
    return np.array(idx, dtype=np.int64), np.array(d).reshape(-1, 3)

def apply(V, rel, w):
    i, d = target(os.path.join(TG, rel))
    V[i] += d * w

ETH = ['african', 'asian', 'caucasian']

def human(gender_w, age_w):
    """gender_w: {'male': .., 'female': ..}; age_w: {'child':..,'young':..,'old':..}"""
    V, _, _ = load_base()
    for g, gw in gender_w.items():
        for a, aw in age_w.items():
            w = gw * aw
            if w <= 0:
                continue
            apply(V, f'macrodetails/universal-{g}-{a}-averagemuscle-averageweight.target', w)
            for e in ETH:
                apply(V, f'macrodetails/{e}-{g}-{a}.target', w / 3)
    return V
