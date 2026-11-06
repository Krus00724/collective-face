"""Sculpts each person's hair and brows as plasticine, after their photograph.

Locks are traced over the fitted head, gathered into one soft volume, and turned into a mesh, the way
strands of plasticine press together into a mass with grooves between them. Each hair vertex is tied to
the nearest point of the head, so a raised brow lifts the fringe with it.

Run: python3 tools/bake_hair.py <scratch dir>     (after fit_faces.py and rendermap)
"""
import base64, json, re, sys
import numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.spatial import cKDTree
from skimage.measure import marching_cubes
import fast_simplification, trimesh

SP = sys.argv[1]
H = 0.0016                     # voxel size in metres
rng = np.random.default_rng(11)

src = open('src/data/bustData.ts').read()
def const(name): return re.search(rf'export const {name} = "([^"]+)"', src).group(1)
part = np.frombuffer(base64.b64decode(const('PART')), np.uint8)

BROW_L = [70, 63, 105, 66, 107]; BROW_LB = [46, 53, 52, 65, 55]
BROW_R = [300, 293, 334, 296, 336]; BROW_RB = [276, 283, 282, 295, 285]


class Head:
    def __init__(self, fig, index):
        self.fig = fig
        self.cage = np.fromfile(f'{SP}/{fig}.fit.bin', np.float32).astype(float).reshape(-1, 3)
        self.dense = np.fromfile(f'{SP}/{fig}.after.pos.bin', np.float32).astype(float).reshape(-1, 3)
        nv = len(self.cage)
        skin = part == 0
        self.skin_idx = np.nonzero(skin)[0]
        pts = self.dense[:]
        # scalp, ears and neck: anything above the shoulders, seen as one surface
        keep = pts[:, 1] > pts[:, 1].max() - 0.34
        self.surface = pts[keep]
        nor = np.zeros_like(pts)
        self.tree = cKDTree(self.surface)
        # outward direction from the head centre stands in for the normal
        self.top = pts[:, 1].max()
        eyes = self.cage[part == 3]
        self.eye_y = eyes[:, 1].mean()
        self.eye_z = eyes[:, 2].mean()
        self.centre = np.array([0, self.eye_y + 0.02, self.eye_z - 0.085])
        r = json.load(open(f'{SP}/after.json'))[index]
        ids = np.fromfile(f'{SP}/{fig}.after.id.bin', np.int32).reshape(1024, 1024)
        l = np.array(r['landmarks'], float)
        px = np.clip((l[:, :2] * 1024).astype(int), 0, 1023)
        self.lm = np.zeros((478, 3))
        self.lm[:] = np.nan
        for i, (x, y) in enumerate(px):
            win = ids[max(0, y - 3):y + 4, max(0, x - 3):x + 4]
            v = win[win >= 0]
            self.lm[i] = self.dense[np.bincount(v).argmax()] if v.size else np.nan

    def hug(self, p, lift):
        """Keeps a point on or above the skin."""
        d, i = self.tree.query(p)
        q = self.surface[i]
        out = p - self.centre
        out = out / (np.linalg.norm(out) + 1e-9)
        h = (p - q) @ out
        if h < lift:
            p = p + out * (lift - h)
        return p


def unit(v):
    return v / (np.linalg.norm(v) + 1e-9)


def fall(head, root, first, length, lift, g=0.22, step=0.005, wander=0.0, stop=None):
    """One strand: starts along the scalp, gravity takes over, the head keeps it out."""
    p = head.hug(root, lift)
    d = unit(first)
    down = np.array([0, -1.0, 0])
    a, b = rng.uniform(0, 6.28, 2)
    f1, f2 = rng.uniform(9, 22), rng.uniform(30, 55)
    out = [p]
    for k in range(int(length / step)):
        side = np.cross(d, [0.2, 0.1, 1.0])
        side2 = np.cross(d, side)
        t = k * step
        d = d * (1 - g) + down * g + unit(side) * wander * np.sin(a + f1 * t) + unit(side2) * wander * 0.7 * np.sin(b + f2 * t)
        d = unit(d)
        q = p + d * step
        if stop is not None and stop(q):
            break
        q = head.hug(q, lift)
        d = unit(q - p)
        p = q
        out.append(p)
    return np.array(out)


def curl(head, root, axis, length, lift, radius, pitch, step=0.0016):
    """One short spiral lock, lying along the scalp."""
    axis = unit(axis)
    u = unit(np.cross(axis, rng.normal(size=3)))
    v = np.cross(axis, u)
    ph = rng.uniform(0, 6.28)
    pts = []
    n = int(length / step)
    drift = rng.normal(size=3) * 0.15
    for k in range(n):
        t = k / n
        s = t * length
        r = radius * min(1, t * 5) * (1 + 0.25 * np.sin(s * 90))
        w = 2 * np.pi * s / pitch + ph
        pts.append(root + unit(axis + drift * t) * s + (u * np.cos(w) + v * np.sin(w)) * r)
    pts = np.array(pts)
    return np.array([head.hug(q, lift) for q in pts[::2]])


class Volume:
    def __init__(self, head):
        self.lo = np.array([-0.15, head.top - 0.32, head.eye_z - 0.26])
        self.hi = np.array([0.15, head.top + 0.06, head.eye_z + 0.08])
        self.shape = np.ceil((self.hi - self.lo) / H).astype(int)
        self.f = np.zeros(self.shape, np.float32)

    def stroke(self, pts, r0, r1, power=1.0):
        """Lays a tapered strand into the volume."""
        seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        s = np.r_[0, np.cumsum(seg)]
        if s[-1] < 1e-4:
            return
        total = s[-1]
        t = 0.0
        while t <= total:
            a = t / total
            p = np.array([np.interp(t, s, pts[:, i]) for i in range(3)])
            r = r0 + (r1 - r0) * a ** 1.6
            self.splat(p, r, power)
            t += max(r * 0.4, H * 0.7)

    def carve(self, p, r):
        """Takes clay away, the way a tool drawn through it would."""
        ijk = (p - self.lo) / H
        w = int(2.4 * r / H) + 1
        lo = np.maximum(np.floor(ijk).astype(int) - w, 0)
        hi = np.minimum(np.floor(ijk).astype(int) + w + 1, self.shape)
        if (hi <= lo).any():
            return
        g = np.ogrid[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
        d2 = (g[0] - ijk[0]) ** 2 + (g[1] - ijk[1]) ** 2 + (g[2] - ijk[2]) ** 2
        k = np.exp(-d2 * (H * H) / (r * r))
        v = self.f[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
        np.minimum(v, (1 - k).astype(np.float32), out=v)

    def splat(self, p, r, power):
        ijk = (p - self.lo) / H
        w = int(2.4 * r / H) + 1
        lo = np.maximum(np.floor(ijk).astype(int) - w, 0)
        hi = np.minimum(np.floor(ijk).astype(int) + w + 1, self.shape)
        if (hi <= lo).any():
            return
        g = np.ogrid[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
        d2 = (g[0] - ijk[0]) ** 2 + (g[1] - ijk[1]) ** 2 + (g[2] - ijk[2]) ** 2
        k = power * np.exp(-d2 * (H * H) / (r * r))
        v = self.f[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
        np.maximum(v, k.astype(np.float32), out=v)


STABLE = [33, 133, 362, 263, 168, 6, 197, 195, 5, 4, 1, 2, 61, 291, 13, 152]
photos = json.load(open(f'{SP}/photos.json'))


def similarity(A, B):
    ca, cb = A.mean(0), B.mean(0)
    H = (A - ca).T @ (B - cb)
    U, S, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    R = Vt.T @ np.diag([1, 1, d]) @ U.T
    return (S * [1, 1, d]).sum() / ((A - ca) ** 2).sum(), R, ca, cb


def brow_lines(head, index):
    """Where this person's brows sit, read from their photograph and laid onto the head."""
    rec = photos[index]
    l = np.array(rec['landmarks'], float)
    P = np.c_[l[:, 0] * rec['w'], -l[:, 1] * rec['h'], -l[:, 2] * rec['w']]
    S = head.lm
    s, R, ca, cb = similarity(P[STABLE], S[STABLE])
    return (s * (R @ (P - ca).T)).T + cb


def brows(head, vol, index, r, gap=0.0):
    T = brow_lines(head, index)
    for u, v in zip(BROW_L + BROW_LB, BROW_R + BROW_RB):
        a, b = T[u].copy(), T[v].copy()
        T[u, :2] = 0.5 * (a[:2] + b[:2] * [-1, 1])
        T[v, :2] = 0.5 * (b[:2] + a[:2] * [-1, 1])
    front = head.dense[(head.dense[:, 2] > head.eye_z - 0.035) & (head.dense[:, 1] > head.eye_y - 0.01) & (np.abs(head.dense[:, 0]) < 0.08)]
    tree = cKDTree(front[:, :2])
    for upper, lower in ((BROW_L, BROW_LB), (BROW_R, BROW_RB)):
        a, b = T[upper], T[lower]
        # the five landmark pairs run outer end to inner end
        n = 46
        for i, t in enumerate(np.linspace(0, 1, n)):
            j = t * (len(a) - 1)
            k = int(min(j, len(a) - 2))
            f = j - k
            top = a[k] * (1 - f) + a[k + 1] * f
            bot = b[k] * (1 - f) + b[k + 1] * f
            taper = np.sin(np.pi * np.clip(t * 0.86 + 0.1, 0, 1)) ** 0.55
            for u in (0.25, 0.5, 0.75):
                u = 0.5 + (u - 0.5) * taper
                q = bot + (top - bot) * u + np.array([0, gap, 0])
                z = front[tree.query(q[:2])[1], 2]
                vol.splat(head.hug(np.array([q[0], q[1], z]), 0.0007), r * (0.6 + 0.4 * taper), 1.0)


def scalp(head, keep, spacing=0.004):
    """Points on the scalp, evenly spread."""
    p = head.dense
    m = keep(p)
    q = p[m]
    cell = np.round(q / spacing).astype(np.int64)
    _, first = np.unique(cell, axis=0, return_index=True)
    return q[first]


def mother(head, vol):
    """A straight long bob with a centre parting. It frames the face and turns in at the ends."""
    top, cz, ey = head.top, head.centre[2], head.eye_y
    end = ey - 0.15
    brow = np.nanmax(head.lm[BROW_L + BROW_R, 1])
    hairline = ey + 0.086
    mid = head.dense[np.abs(head.dense[:, 0]) < 0.006]
    front = mid[mid[:, 1] > hairline, 2].max()
    def arch(y):
        """How far the hair stays from the middle of the face, at each height."""
        if y >= brow:
            t = min(1, (y - brow) / (hairline - brow))
            return 0.064 * np.sqrt(max(0, 1 - t * t))
        return 0.064 + 0.05 * (brow - y) * 0.3
    def keep_out(q, extra):
        if q[2] > head.eye_z - 0.075:
            w = arch(q[1]) + extra
            if abs(q[0]) < w:
                q = q.copy()
                q[0] = np.sign(q[0] if q[0] else 1) * w
        return q
    def strand(root, first, r0, lift, stop_at=None):
        stop_at = end if stop_at is None else stop_at
        p = head.hug(head.surface[head.tree.query(root)[1]], lift * 0.3)
        d = unit(first)
        out = [p]
        down = np.array([0, -1.0, 0])
        a, f = rng.uniform(0, 6.28), rng.uniform(12, 24)
        sway = rng.uniform(0.0, 0.03)
        extra = rng.uniform(0, 0.016) ** 1.5 * 12
        for k in range(120):
            side = unit(np.cross(d, [0, 0, 1]))
            d = unit(d * 0.78 + down * 0.22 + side * sway * np.sin(a + f * k * 0.005))
            q = keep_out(head.hug(p + d * 0.005, lift * min(1, 0.3 + k / 16)), extra)
            d = unit(q - p)
            p = q
            out.append(p)
            if p[1] < stop_at:
                break
        pts = np.array(out)
        # it falls straight past the ear, it does not dip in above it
        sign = np.sign(pts[:, 0] + 1e-9)
        above = pts[:, 1] > ey - 0.06
        reach = np.maximum.accumulate(np.abs(pts[:, 0]))
        wide = (np.abs(pts[:, 0]) > 0.06) & above
        pts[wide, 0] = (sign * reach)[wide]
        # below the ears it hangs closer to the neck, and the ends turn in, the way a bob does
        turn = np.clip((end + 0.05 - pts[:, 1]) / 0.05, 0, 1) ** 2
        hang = np.clip((ey - 0.015 - pts[:, 1]) / 0.08, 0, 1)
        pts[:, 0] *= (1 - 0.15 * hang) * (1 - 0.14 * turn)
        pts[:, 2] = cz - 0.02 + (pts[:, 2] - cz + 0.02) * (1 - 0.3 * turn)
        vol.stroke(pts, r0, r0 * 0.72, 1.0)
    for side in (-1, 1):
        for i in range(110):
            t = rng.uniform(0, 1)
            z = front - t * (front - cz + 0.05)
            root = np.array([side * rng.uniform(0.0005, 0.006), hairline if z > cz + 0.03 else top, z])
            strand(root, np.array([side * 1.0, -0.15, rng.uniform(-0.18, 0.12)]), 0.0068, rng.uniform(0.0006, 0.002), end + 0.007)
        for i in range(240):
            # from the parting, front to crown
            t = rng.uniform(0, 1)
            z = front - t * (front - cz + 0.05)
            root = np.array([side * rng.uniform(0.0005, 0.006), hairline if z > cz + 0.03 else top, z])
            strand(root, np.array([side * 1.0, -0.15, rng.uniform(-0.18, 0.12)]), rng.uniform(0.0034, 0.0048), rng.uniform(0.002, 0.0085))
    back = scalp(head, lambda p: (p[:, 2] < cz - 0.015) & (p[:, 1] > ey - 0.075) & (np.abs(p[:, 0]) < 0.1), 0.0058)
    for q in back:
        strand(q, np.array([q[0] * 2, -0.4, -0.5]), 0.0068, rng.uniform(0.0006, 0.002), end + 0.007)
        strand(q, np.array([q[0] * 2, -0.4, -0.5]), rng.uniform(0.0034, 0.0048), rng.uniform(0.002, 0.0085))
    # the parting, drawn through the hair from the forehead back over the crown
    line = mid[(mid[:, 1] > hairline - 0.006) & (mid[:, 2] > cz - 0.06)]
    line = line[np.argsort(line[:, 2])]
    for q in line[::2]:
        for lift in (0.0025, 0.006, 0.0095, 0.013, 0.017):
            vol.carve(np.array([0, q[1] + lift, q[2]]), 0.0032)
    brows(head, vol, 0, 0.0023)


def father(head, vol):
    """A thick shaggy mop from a whorl at the crown, in chunky locks, the fringe down to the brows."""
    top, ey, cz = head.top, head.eye_y, head.centre[2]
    brow = np.nanmax(head.lm[BROW_L + BROW_R, 1])
    whorl = np.array([0.008, top, cz - 0.06])
    def floor(q):
        ang = np.degrees(np.arctan2(abs(q[0]), q[2] - cz))
        return np.interp(ang, [0, 34, 60, 88, 120, 180], [brow + 0.0, brow + 0.002, brow - 0.016, ey - 0.03, ey - 0.06, ey - 0.098])
    roots = scalp(head, lambda p: (p[:, 1] > ey + 0.03) & (p[:, 1] > ey + 0.045 + 0.1 * np.clip((p[:, 2] - cz + 0.02) / 0.1, 0, 1) ** 2) & (np.abs(p[:, 0]) < 0.094), 0.0095)
    print('  locks', len(roots))
    for layer in range(3):
        for q in roots:
            flow = q - whorl
            flow[1] = 0
            flow = unit(flow)
            jag = rng.uniform(-0.002, 0.017) + 0.012 * layer
            def stop(x, jag=jag):
                return x[1] < floor(x) + jag
            lift = (0.006, 0.0115, 0.0165)[layer] + rng.uniform(0, 0.004)
            guide = fall(head, q + rng.normal(size=3) * 0.004, flow + np.array([0, 0.12, 0]), 0.2, lift, g=0.17, step=0.005, wander=0.07, stop=stop)
            if len(guide) < 4:
                continue
            m = len(guide)
            for k in range(9):
                off = rng.normal(size=3) * 0.0066
                t = np.linspace(0, 1, m)[:, None]
                pts = guide + off * (1 - t ** 2.2)
                keep = np.linspace(0, m - 1, max(4, m // 2)).astype(int)
                pts = np.array([head.hug(x, 0.004) for x in pts[keep]])
                # the mop stays a mop: it does not flare out over the ears
                limit = np.interp(pts[:, 1], [ey - 0.1, ey - 0.03, ey + 0.05], [0.09, 0.104, 0.116]) + rng.uniform(-0.004, 0.006)
                pts[:, 0] = limit * np.tanh(pts[:, 0] / limit)
                vol.stroke(pts, rng.uniform(0.0038, 0.0052), 0.0013, 1.0)
    brows(head, vol, 1, 0.0028)


def child(head, vol):
    """Short curls all over, loose on top, a curly fringe, and a curly tail at the nape."""
    top, ey, cz = head.top, head.eye_y, head.centre[2]
    brow = np.nanmax(head.lm[BROW_L + BROW_R, 1])
    crown = np.array([0, top, cz - 0.03])
    down = np.array([0, -1.0, 0])
    def line(p):
        ang = np.degrees(np.arctan2(np.abs(p[:, 0]), p[:, 2] - cz))
        return np.interp(ang, [0, 45, 68, 95, 120, 180], [ey + 0.082, ey + 0.066, ey + 0.03, ey + 0.016, ey - 0.03, ey - 0.075])
    roots = scalp(head, lambda p: (p[:, 1] > line(p)) & (np.abs(p[:, 0]) < 0.094) & (p[:, 1] > ey - 0.08), 0.0062)
    print('  curls', len(roots))
    # a thin skin of clay first, so no scalp shows between the curls
    for q in roots:
        vol.splat(head.hug(q, rng.uniform(0.001, 0.003)), rng.uniform(0.0046, 0.0062), 1.0)
    for q in roots:
        flow = q - crown
        flow[1] = 0
        flow = unit(flow + rng.normal(size=3) * 0.35)
        topness = np.clip((q[1] - (ey + 0.05)) / (top - ey - 0.05), 0, 1)
        length = rng.uniform(0.018, 0.03) + 0.012 * topness
        lift = rng.uniform(0.004, 0.0075) + 0.005 * topness
        pts = curl(head, q, flow + down * 0.7, length, lift, rng.uniform(0.0034, 0.0052), rng.uniform(0.012, 0.016))
        vol.stroke(pts, rng.uniform(0.0031, 0.0041), 0.0022, 1.0)
    # the fringe: a few curls coming down onto the forehead
    fr = roots[(roots[:, 2] > cz + 0.03) & (roots[:, 1] < ey + 0.1)]
    for q in fr[rng.permutation(len(fr))[:26]]:
        pts = curl(head, q, np.array([rng.uniform(-0.3, 0.3), -1, 0.1]), rng.uniform(0.022, 0.036), rng.uniform(0.003, 0.006), rng.uniform(0.0036, 0.0054), rng.uniform(0.012, 0.016))
        pts = pts[pts[:, 1] > brow + 0.016]
        if len(pts) > 4:
            vol.stroke(pts, rng.uniform(0.0031, 0.004), 0.0022, 1.0)
    # the tail: down the nape and behind the ears
    nape = scalp(head, lambda p: (p[:, 2] < cz - 0.03) & (p[:, 1] > ey - 0.085) & (p[:, 1] < ey - 0.02) & (np.abs(p[:, 0]) < 0.08), 0.0085)
    for q in nape:
        pts = curl(head, q, np.array([0.25 * np.sign(q[0]), -1, -0.2]), rng.uniform(0.028, 0.05), rng.uniform(0.004, 0.0075), rng.uniform(0.0036, 0.0056), rng.uniform(0.013, 0.017))
        vol.stroke(pts, rng.uniform(0.003, 0.0039), 0.0021, 1.0)
    brows(head, vol, 3, 0.0024)


def finish(head, vol, target):
    f = gaussian_filter(vol.f, 0.6)
    # hollow it out: nothing is needed deep inside the head
    v, tri, _, _ = marching_cubes(f, 0.5, spacing=(H, H, H), allow_degenerate=False)
    v = v + vol.lo
    d = head.tree.query(v)[0]
    centre = head.centre
    inside = np.linalg.norm(v - centre, axis=1) < 0.07
    keep = ~inside[tri].all(1)
    m = trimesh.Trimesh(v, tri[keep], process=False)
    m.remove_unreferenced_vertices()
    # crumbs of clay that came away from the mass
    from scipy.sparse.csgraph import connected_components
    from scipy.sparse import coo_matrix
    e = m.edges_unique
    _, lab = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(len(m.vertices),) * 2), directed=False)
    size = np.bincount(lab)
    m = trimesh.Trimesh(m.vertices, m.faces[size[lab[m.faces[:, 0]]] > 90], process=False)
    m.remove_unreferenced_vertices()
    print('  raw', len(m.vertices), 'verts', len(m.faces), 'faces')
    pts, faces = fast_simplification.simplify(np.asarray(m.vertices, np.float32), np.asarray(m.faces, np.int32), target_count=target * 2)
    m = trimesh.Trimesh(pts, faces, process=True)
    # smooth normals from the field, sharper than from the reduced mesh
    blur = gaussian_filter(vol.f, 1.1)
    g = np.gradient(blur)
    ijk = ((m.vertices - vol.lo) / H).T
    n = np.stack([map_coordinates(c, ijk, order=1) for c in g], 1)
    n = -n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-9)
    # occlusion: how buried a point is, in the grooves and in the mass of hair
    fine = map_coordinates(gaussian_filter(vol.f, 1.7), ijk, order=1)
    wide = map_coordinates(gaussian_filter(vol.f, 5), ijk, order=1)
    occ = (1 - np.clip((fine - 0.5) * 1.6, 0, 0.6)) * (1 - np.clip((wide - 0.5) * 1.2, 0, 0.4))
    near = head.tree.query(m.vertices)[0]
    occ = 0.42 + 0.58 * occ * (0.7 + 0.3 * np.clip(near / 0.012, 0, 1))
    # keep the winding the way the field says
    tri = m.vertices[m.faces]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    faces = m.faces
    if (fn * n[faces[:, 0]]).sum() < 0:
        faces = faces[:, ::-1]
    # the field gives the fine shading, the surface keeps it honest on thin ridges
    mn = np.asarray(trimesh.Trimesh(m.vertices, faces, process=False).vertex_normals)
    n = n + mn * 0.8
    n = n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-9)
    bad = (n * mn).sum(1) < 0.3
    n[bad] = mn[bad]
    # a collapsed vertex has no normal of its own: point it away from the head
    lost = ~(np.linalg.norm(n, axis=1) > 0.5)
    away = m.vertices[lost] - head.centre
    n[lost] = away / np.linalg.norm(away, axis=1, keepdims=True)
    print('  lost normals', int(lost.sum()))
    # tie each vertex to the three nearest points of the cage, leaving out the jaw: hair does not
    # travel with a mouth that opens
    c = head.cage
    skin = head.skin_idx[~((c[head.skin_idx, 1] < head.eye_y - 0.02) & (c[head.skin_idx, 2] > head.eye_z - 0.1))]
    bind = skin[cKDTree(c[skin]).query(m.vertices, k=3)[1]]
    return m.vertices, n, occ, faces, bind


b64 = lambda a: base64.b64encode(a.tobytes()).decode()
out = '/* Generated by tools/bake_hair.py. Do not edit. */\n'
for i, (fig, fn, target) in enumerate((('mother', mother, 26000), ('father', father, 28000), ('child', child, 28000))):
    head = Head(fig, i)
    vol = Volume(head)
    fn(head, vol)
    v, n, occ, f, bind = finish(head, vol, target)
    print(fig, 'hair verts', len(v), 'tris', len(f))
    K = fig.upper()
    out += f'export const HAIR_{K}_POS = "{b64(np.round(v * 25000).astype(np.int16))}";\n'
    out += f'export const HAIR_{K}_NOR = "{b64(np.round(n * 127).astype(np.int8))}";\n'
    out += f'export const HAIR_{K}_OCC = "{b64(np.round(occ * 255).astype(np.uint8))}";\n'
    out += f'export const HAIR_{K}_IDX = "{b64(f.astype(np.uint16).ravel())}";\n'
    out += f'export const HAIR_{K}_BIND = "{b64(bind.astype(np.uint16))}";\n'
open('src/data/hairData.ts', 'w').write(out)
print(len(out) // 1024, 'KB')
