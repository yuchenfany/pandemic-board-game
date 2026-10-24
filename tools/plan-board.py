#!/usr/bin/env python3
"""Plans a themed board (universities, East Asia): where each place sits and which city slot it takes.

A themed board must play exactly like the cities board, so it reuses the cities board's graph: every
place takes one city's slot (its connections; colors are renamed consistently). This script picks
that assignment so that

  * each color is one region (REGIONS, 12 places each), and
  * connected places are close together, with no crossing links, no link passing over another place,
    and few wrap-around links (drawn off one map edge and back in at the other, like the Pacific).

Steps: real lat/lon -> stylised board positions (`target`: squeezes empty areas, stretches crowded
ones), push places apart, then simulated annealing over the assignment. With --write it replaces the
board's block in public/shared/data.js; otherwise it prints it. Regenerate the background afterwards:
  node tools/build-worldmap.js <board>

Usage: python3 tools/plan-board.py <universities|eastasia> [--write] [seeds=6] [steps=200000]
(needs numpy and node; takes a few minutes)
"""
import itertools, json, math, os, re, subprocess, sys
import numpy as np

ROOT = __file__.rsplit('/tools/', 1)[0]
W, H = 1240, 660
COLORS = ['blue', 'yellow', 'black', 'red']  # slot colors of the cities board, in this order


def us_target(lat, lon):
    # x: California gets the room the near-empty Mountain time zone doesn't need. y: the West Coast
    # is raised and stretched so its 11 California schools spread out.
    x = np.interp(lon, [-124, -117, -110, -105, -93, -84, -76, -71], [45, 430, 470, 530, 660, 840, 1015, 1190])
    y = np.where(lon < -114, np.interp(lat, [32.5, 34, 38.5, 47.7, 49.3], [500, 420, 260, 95, 40]),
                 np.interp(lat, [29.5, 33, 38, 42, 45.6, 49.3], [625, 545, 390, 215, 110, 45]))
    return x, y


def asia_target(lat, lon):
    # x: the far west (Urumqi to Lanzhou) is squeezed; the crowded east coast, Korea and Japan get room.
    x = np.interp(lon, [87, 100, 104, 109, 113, 117, 121.5, 124, 127, 129.5, 131, 136, 141.5],
                  [45, 110, 170, 290, 420, 560, 720, 790, 850, 915, 960, 1075, 1195])
    y = np.interp(lat, [22, 25, 30, 35, 40, 46], [625, 540, 405, 270, 150, 40])
    return x, y


BOARDS = {
    'universities': dict(
        const=('UNIVERSITIES', 'UNIVERSITY_EDGES', 'UNIVERSITY_SLOTS'), target=us_target,
        places={  # name: (lat, lon)
            'UC Berkeley': (37.872, -122.259), 'Stanford': (37.428, -122.170), 'UCSF': (37.763, -122.458),
            'UCD': (38.539, -121.750), 'UCSB': (34.414, -119.849), 'UCLA': (34.069, -118.445),
            'USC': (34.022, -118.285), 'Caltech': (34.138, -118.125), 'UCI': (33.640, -117.844),
            'UCSD': (32.880, -117.234), 'Scripps': (32.896, -117.243), 'UW': (47.655, -122.308),
            'UBC': (49.261, -123.246), 'Utah': (40.765, -111.842), 'CU Boulder': (40.007, -105.266),
            'UT Austin': (30.285, -97.734), 'Texas A&M': (30.619, -96.339), 'Rice': (29.717, -95.402),
            'UTSW': (32.812, -96.839), 'UMinnesota': (44.974, -93.228), 'UWisconsin': (43.076, -89.412),
            'WashU': (38.649, -90.311), 'UIUC': (40.102, -88.227), 'UChicago': (41.789, -87.600),
            'Northwestern': (42.056, -87.675), 'Purdue': (40.424, -86.921), 'Indiana': (39.168, -86.523),
            'UMich': (42.278, -83.738), 'Vanderbilt': (36.145, -86.803), 'Georgia Tech': (33.776, -84.398),
            'Emory': (33.791, -84.324), 'Duke': (36.001, -78.938), 'UNC': (35.905, -79.047),
            'Virginia Tech': (37.228, -80.423), 'UMaryland': (38.987, -76.943), 'JHU': (39.329, -76.620),
            'CMU': (40.443, -79.943), 'UToronto': (43.663, -79.396), 'McGill': (45.505, -73.577),
            'UPenn': (39.952, -75.193), 'Princeton': (40.343, -74.651), 'Columbia': (40.808, -73.962),
            'NYU': (40.730, -73.997), 'Cornell Tech': (40.756, -73.956), 'Cornell': (42.453, -76.473),
            'Yale': (41.316, -72.922), 'Harvard': (42.377, -71.117), 'MIT': (42.360, -71.094),
        },
        regions={
            'west': ['UW', 'UC Berkeley', 'Stanford', 'UCSF', 'UCD', 'UCSB', 'UCLA', 'USC', 'Caltech', 'UCI', 'UCSD', 'Scripps'],
            'north/midwest': ['UBC', 'Utah', 'CU Boulder', 'UMinnesota', 'UWisconsin', 'WashU', 'UIUC', 'UChicago', 'Northwestern', 'Purdue', 'Indiana', 'UMich'],
            'south': ['UT Austin', 'Texas A&M', 'Rice', 'UTSW', 'Vanderbilt', 'Emory', 'Georgia Tech', 'Duke', 'UNC', 'Virginia Tech', 'UMaryland', 'JHU'],
            'northeast': ['CMU', 'UToronto', 'McGill', 'UPenn', 'Princeton', 'Columbia', 'NYU', 'Cornell Tech', 'Cornell', 'Yale', 'Harvard', 'MIT'],
        },
        color_of={'west': 'blue', 'south': 'red', 'north/midwest': 'black', 'northeast': 'yellow'},
        # Which region takes which slot color (blue, yellow, black, red). The region in blue's slots
        # holds the start (Austin's slot). None = let the script try every mapping (a short trial each).
        slots=('south', 'north/midwest', 'northeast', 'west'), start=None,
        nudge={'Utah': (0, 55)},  # offsets to target positions before layout, px
        fix={'Virginia Tech': (878, 404), 'UMaryland': (1006, 392), 'USC': (300, 500), 'Stanford': (168, 288),
             'UCI': (400, 425), 'UCSD': (445, 485), 'Cornell': (998, 185), 'Emory': (872, 536)},  # final positions
    ),
    'eastasia': dict(
        const=('EAST_ASIA', 'EAST_ASIA_EDGES', 'EAST_ASIA_SLOTS'), target=asia_target,
        places={
            'Beijing': (39.904, 116.407), 'Tianjin': (39.084, 117.201), 'Shijiazhuang': (38.042, 114.515),
            'Taiyuan': (37.870, 112.549), 'Jinan': (36.651, 117.120), 'Qingdao': (36.067, 120.383),
            'Zhengzhou': (34.747, 113.625), 'Shenyang': (41.805, 123.432), 'Dalian': (38.914, 121.615),
            'Changchun': (43.817, 125.324), 'Harbin': (45.803, 126.535), "Xi'an": (34.341, 108.940),
            'Shanghai': (31.230, 121.474), 'Nanjing': (32.060, 118.797), 'Hangzhou': (30.274, 120.155),
            'Yangzhou': (32.394, 119.413), 'Wenzhou': (28.000, 120.672), 'Ningbo': (29.868, 121.544),
            'Hefei': (31.821, 117.227), 'Wuhan': (30.593, 114.305), 'Changsha': (28.228, 112.939),
            'Nanchang': (28.682, 115.858), 'Fuzhou': (26.074, 119.296), 'Xiamen': (24.480, 118.089),
            'Guangzhou': (23.129, 113.264), 'Shenzhen': (22.543, 114.058), 'Hong Kong': (22.320, 114.170),
            'Zhangjiajie': (29.117, 110.479), 'Lhasa': (29.652, 91.172), 'Nanning': (22.817, 108.367),
            'Kunming': (25.039, 102.718), 'Guiyang': (26.647, 106.630), 'Chongqing': (29.563, 106.551),
            'Chengdu': (30.573, 104.066), 'Lanzhou': (36.061, 103.834), 'Ürümqi': (43.825, 87.617),
            'Tokyo': (35.690, 139.692), 'Yokohama': (35.444, 139.638), 'Osaka': (34.694, 135.502),
            'Nagoya': (35.181, 136.906), 'Kobe': (34.690, 135.196), 'Kyoto': (35.012, 135.768),
            'Fukuoka': (33.590, 130.402), 'Sapporo': (43.062, 141.354), 'Seoul': (37.567, 126.978),
            'Busan': (35.180, 129.076), 'Incheon': (37.456, 126.705), 'Daegu': (35.871, 128.601),
        },
        regions={
            'north': ['Beijing', 'Tianjin', 'Shijiazhuang', 'Taiyuan', 'Jinan', 'Qingdao', 'Zhengzhou', 'Shenyang', 'Dalian', 'Changchun', 'Harbin', "Xi'an"],
            'east': ['Shanghai', 'Nanjing', 'Yangzhou', 'Hangzhou', 'Ningbo', 'Hefei', 'Wuhan', 'Changsha', 'Nanchang', 'Fuzhou', 'Xiamen', 'Wenzhou'],
            'south/west': ['Guangzhou', 'Shenzhen', 'Hong Kong', 'Nanning', 'Kunming', 'Guiyang', 'Chongqing', 'Chengdu', 'Zhangjiajie', 'Lanzhou', 'Lhasa', 'Ürümqi'],
            'japan/korea': ['Tokyo', 'Yokohama', 'Osaka', 'Nagoya', 'Kobe', 'Kyoto', 'Fukuoka', 'Sapporo', 'Seoul', 'Busan', 'Incheon', 'Daegu'],
        },
        color_of={'north': 'blue', 'east': 'yellow', 'south/west': 'black', 'japan/korea': 'red'},
        # Shown on infection cards and city tooltips: (province or region, simplified Chinese name).
        info={
            'Beijing': ('Beijing Municipality', '北京'), 'Tianjin': ('Tianjin Municipality', '天津'),
            'Shijiazhuang': ('Hebei', '石家庄'), 'Taiyuan': ('Shanxi', '太原'), 'Jinan': ('Shandong', '济南'),
            'Qingdao': ('Shandong', '青岛'), 'Zhengzhou': ('Henan', '郑州'), 'Shenyang': ('Liaoning', '沈阳'),
            'Dalian': ('Liaoning', '大连'), 'Changchun': ('Jilin', '长春'), 'Harbin': ('Heilongjiang', '哈尔滨'),
            "Xi'an": ('Shaanxi', '西安'),
            'Shanghai': ('Shanghai Municipality', '上海'), 'Nanjing': ('Jiangsu', '南京'), 'Yangzhou': ('Jiangsu', '扬州'),
            'Hangzhou': ('Zhejiang', '杭州'), 'Ningbo': ('Zhejiang', '宁波'), 'Hefei': ('Anhui', '合肥'),
            'Wuhan': ('Hubei', '武汉'), 'Changsha': ('Hunan', '长沙'), 'Nanchang': ('Jiangxi', '南昌'),
            'Fuzhou': ('Fujian', '福州'), 'Xiamen': ('Fujian', '厦门'), 'Wenzhou': ('Zhejiang', '温州'),
            'Guangzhou': ('Guangdong', '广州'), 'Shenzhen': ('Guangdong', '深圳'), 'Hong Kong': ('Hong Kong SAR', '香港'),
            'Nanning': ('Guangxi', '南宁'), 'Kunming': ('Yunnan', '昆明'), 'Guiyang': ('Guizhou', '贵阳'),
            'Chongqing': ('Chongqing Municipality', '重庆'), 'Chengdu': ('Sichuan', '成都'), 'Zhangjiajie': ('Hunan', '张家界'),
            'Lanzhou': ('Gansu', '兰州'), 'Lhasa': ('Tibet', '拉萨'), 'Ürümqi': ('Xinjiang', '乌鲁木齐'),
            'Tokyo': ('Tokyo, Japan', '东京'), 'Yokohama': ('Kanagawa, Japan', '横滨'), 'Osaka': ('Osaka, Japan', '大阪'),
            'Nagoya': ('Aichi, Japan', '名古屋'), 'Kobe': ('Hyogo, Japan', '神户'), 'Kyoto': ('Kyoto, Japan', '京都'),
            'Fukuoka': ('Fukuoka, Japan', '福冈'), 'Sapporo': ('Hokkaido, Japan', '札幌'),
            'Seoul': ('South Korea', '首尔'), 'Busan': ('South Korea', '釜山'), 'Incheon': ('South Korea', '仁川'),
            'Daegu': ('South Korea', '大邱'),
        },
        slots=('north', 'east', 'japan/korea', 'south/west'), start=None, costs=(250, 400, 400),
        nudge={}, fix={},
    ),
}

args = [a for a in sys.argv[1:] if not a.startswith('--')]
if not args or args[0] not in BOARDS: sys.exit(__doc__)
cfg = BOARDS[args[0]]
seeds = int(args[1]) if len(args) > 1 else 6
steps = int(args[2]) if len(args) > 2 else 200000
SEED0 = int(os.environ.get('SEED0', 0))  # first random seed (run several in parallel with different SEED0)
PLACES, REGIONS = cfg['places'], cfg['regions']
GRAZE = 24  # px: a link closer than this to another place's center looks like it passes through it
# per wrap-around link / crossing pair / link passing over a place (a board can override with costs=)
WRAP_COST, CROSS_COST, NEAR_COST = cfg.get('costs', (250, 120, 400))

# ---- cities board graph (from data.js)
src = "const D=require('./public/shared/data');console.log(JSON.stringify({C:D.BOARDS.cities.cities,E:D.BOARDS.cities.edges,S:D.BOARDS.cities.start}))"
O = json.loads(subprocess.check_output(['node', '-e', src], cwd=ROOT))
nodes = list(O['C']); col = [O['C'][v]['color'] for v in nodes]
E = [(nodes.index(a), nodes.index(b)) for a, b in O['E']]
START_NODE = nodes.index(O['S'])
assert len(PLACES) == len(nodes) == 48 and sorted(sum(REGIONS.values(), [])) == sorted(PLACES)
assert all(len(r) == 12 for r in REGIONS.values())

# ---- layout: stylised target positions, then push apart to >= 76px
S = list(PLACES); n = len(S)
lat = np.array([PLACES[s][0] for s in S]); lon = np.array([PLACES[s][1] for s in S])
T = np.stack(cfg['target'](lat, lon), 1) + np.array([cfg['nudge'].get(s, (0, 0)) for s in S])
P = T + np.random.default_rng(0).normal(0, 1, T.shape)
for _ in range(5000):
    d = P[:, None] - P[None]; r = np.linalg.norm(d, axis=2) + np.eye(n) * 1e9
    P += (np.clip(76 - r, 0, None)[:, :, None] * d / r[:, :, None]).sum(1) * 0.25 + (T - P) * 0.015
    P[:, 0] = np.clip(P[:, 0], 40, W - 40); P[:, 1] = np.clip(P[:, 1], 38, H - 30)
for name, xy in cfg['fix'].items(): P[S.index(name)] = xy
P = P.round()

# ---- geometry of every possible link (recomputed whenever positions change)
def crosses(p1, p2, p3, p4):
    o = lambda a, b, c: (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    return o(p1, p2, p3) * o(p1, p2, p4) < 0 and o(p3, p4, p1) * o(p3, p4, p2) < 0
pairs = [(i, j) for i in range(n) for j in range(i + 1, n)]
PID = np.full((n, n), -1)
for k, (i, j) in enumerate(pairs): PID[i, j] = PID[j, i] = k
def link_segs(P, i, j):  # a link is drawn across the map edge when that is shorter (like the Pacific)
    a, b = P[i], P[j]
    if abs(a[0] - b[0]) <= W / 2: return [(a, b)]
    w, e = (a, b) if a[0] < b[0] else (b, a)
    return [(w, e - [W, 0]), (e, w + [W, 0])]
def geometry(P):
    global L, WR, X, NEAR
    L = np.zeros((n, n)); WR = np.zeros((n, n), bool); G = {}
    for k, (i, j) in enumerate(pairs):
        G[k] = link_segs(P, i, j); WR[i, j] = WR[j, i] = len(G[k]) == 2
        L[i, j] = L[j, i] = np.linalg.norm(G[k][0][1] - G[k][0][0]) if len(G[k]) == 1 else \
            np.linalg.norm(G[k][0][1] - G[k][0][0])
    X = np.zeros((len(pairs), len(pairs)), np.uint8); NEAR = np.zeros(len(pairs))
    for a, (i, j) in enumerate(pairs):
        for b in range(a + 1, len(pairs)):
            p, q = pairs[b]
            if len({i, j, p, q}) == 4 and any(crosses(*s1, *s2) for s1 in G[a] for s2 in G[b]): X[a, b] = X[b, a] = 1
        for k in range(n):
            if k in (i, j): continue
            for A, B in G[a]:
                t = np.clip(np.dot(P[k] - A, B - A) / np.dot(B - A, B - A), 0, 1)
                NEAR[a] += np.linalg.norm(A + t * (B - A) - P[k]) < GRAZE

Ea = np.array([e[0] for e in E]); Eb = np.array([e[1] for e in E])
def cost(f):
    sa, sb = f[Ea], f[Eb]; pid = PID[sa, sb]
    return L[sa, sb].sum() + WRAP_COST * WR[sa, sb].sum() + CROSS_COST * X[np.ix_(pid, pid)].sum() / 2 + NEAR_COST * NEAR[pid].sum()

# ---- anneal: swaps within a slot color only, so every region keeps its color
byColor = {c: [v for v in range(n) if col[v] == c] for c in COLORS}
start = cfg['start']
def anneal(perm, seed, budget, f0=None, temp0=300):
    rng = np.random.default_rng(seed)
    if f0 is not None: f = f0.copy()
    else:
        f = np.zeros(n, int)
        for c, reg in zip(COLORS, perm):
            sch = [S.index(x) for x in REGIONS[reg]]; rng.shuffle(sch); f[byColor[c]] = sch
        if start:  # pin the start place to the start city's slot
            a, b = START_NODE, int(np.where(f == S.index(start))[0][0]); f[a], f[b] = f[b], f[a]
    cur = cost(f)
    for t in range(budget):
        temp = temp0 * (0.9 / temp0) ** (t / budget)
        u, v = rng.choice(byColor[COLORS[rng.integers(4)]], 2, replace=False)
        if start and START_NODE in (u, v): continue
        f[u], f[v] = f[v], f[u]; c2 = cost(f)
        if c2 < cur or rng.random() < math.exp((cur - c2) / temp): cur = c2
        else: f[u], f[v] = f[v], f[u]
    return cur, perm, f

# ---- untangle: nudge places (staying near their layout spot) until no links cross, no link passes
# over another place, and no labels collide. Vectorised over all links / places.
LW = np.array([len(s) * 8.2 + 6 for s in S])  # label width: ~8.2px per character, centered 27px below
def issues(P, f, detail=False):
    a, b = f[Ea], f[Eb]
    A, B = P[a].copy(), P[b].copy(); wrap = np.abs(A[:, 0] - B[:, 0]) > W / 2
    sw = np.where(A[:, 0] < B[:, 0], 1, -1)  # wrapped links: two pieces, out of each side
    A2, B2 = B.copy(), A.copy()
    B[wrap, 0] -= sw[wrap] * W; B2[wrap, 0] += sw[wrap] * W
    sA = np.concatenate([A, A2[wrap]]); sB = np.concatenate([B, B2[wrap]])
    owner = np.concatenate([np.arange(len(E)), np.where(wrap)[0]])
    ends = np.stack([a, b], 1)[owner]
    o = lambda p, q, r: (q[..., 0] - p[..., 0]) * (r[..., 1] - p[..., 1]) - (q[..., 1] - p[..., 1]) * (r[..., 0] - p[..., 0])
    p1, p2, p3, p4 = sA[:, None], sB[:, None], sA[None], sB[None]
    cx = (o(p1, p2, p3) * o(p1, p2, p4) < 0) & (o(p3, p4, p1) * o(p3, p4, p2) < 0)
    share = (ends[:, None, :, None] == ends[None, :, None, :]).any((2, 3))
    cx &= ~share & (owner[:, None] < owner[None])
    d = sB - sA; t = np.clip(((P[None] - sA[:, None]) * d[:, None]).sum(2) / (d * d).sum(1)[:, None], 0, 1)
    dist = np.linalg.norm(sA[:, None] + t[..., None] * d[:, None] - P[None], axis=2)
    gz = dist < GRAZE; gz[np.arange(len(owner)), ends[:, 0]] = False; gz[np.arange(len(owner)), ends[:, 1]] = False
    dx = np.abs(P[:, None, 0] - P[None, :, 0]); dy = P[None, :, 1] - P[:, None, 1]
    lab = np.triu((dx < (LW[:, None] + LW[None]) / 2) & (np.abs(dy) < 16), 1)
    over = (dx < LW[:, None] / 2 + 11) & (dy - 27 < 11) & (dy - 27 > -22); np.fill_diagonal(over, False)
    close = np.triu(np.hypot(dx, dy) < 70, 1)
    if not detail: return int(cx.sum() + gz.sum() + lab.sum() + over.sum() + close.sum())
    lk = lambda i: f'{S[a[owner[i]]]}–{S[b[owner[i]]]}'
    return ([f'cross {lk(i)} x {lk(j)}' for i, j in zip(*np.where(cx))] + [f'{lk(i)} over {S[k]}' for i, k in zip(*np.where(gz))] +
            [f'labels {S[i]} / {S[j]}' for i, j in zip(*np.where(lab))] + [f'label {S[i]} over {S[j]}' for i, j in zip(*np.where(over))] +
            [f'too close {S[i]} / {S[j]}' for i, j in zip(*np.where(close))])
def untangle(P, f, P0, rounds=20000, seed=0):
    rng = np.random.default_rng(seed); P = P.copy()
    score = lambda P, k: 1000 * k + np.linalg.norm(P - P0, axis=1).sum() / 2
    k = issues(P, f); cur = score(P, k)
    for r in range(rounds):
        if k == 0 and r > rounds // 4: break
        i = rng.integers(n); old = P[i].copy()
        P[i] = np.clip(P[i] + rng.normal(0, 14 if rng.random() < 0.6 else 45, 2), [40, 38], [W - 40, H - 30]).round()
        if np.linalg.norm(P[i] - P0[i]) > 130: P[i] = old; continue
        k2 = issues(P, f); c2 = score(P, k2)
        if c2 <= cur: cur, k = c2, k2
        else: P[i] = old
    return P

# ---- alternate: assign (anneal) -> nudge positions (untangle) -> re-assign on the new positions
if cfg['slots']: perm = tuple(cfg['slots'])
else:  # the start's region must take the start city's color
    geometry(P)
    startRegion = next((r for r, m in REGIONS.items() if start in m), None)
    perms = [p for p in itertools.permutations(REGIONS) if not start or p[COLORS.index(col[START_NODE])] == startRegion]
    perm = min((anneal(p, 0, steps // 4) for p in perms), key=lambda r: r[0])[1]
P0 = P.copy(); f = None
for rnd in range(4):
    geometry(P)
    if f is None: cur, perm, f = min((anneal(perm, s, steps) for s in range(SEED0, SEED0 + seeds)), key=lambda r: r[0])
    else: cur, perm, f = anneal(perm, rnd, steps // 2, f0=f, temp0=40)
    P = untangle(P, f, P0)
    left = issues(P, f, detail=True)
    print(f'round {rnd + 1}: {len(left)} issues left', file=sys.stderr)
    if not left: break
geometry(P)
sa, sb = f[Ea], f[Eb]; pid = PID[sa, sb]
print(f'{args[0]}: {dict(zip(COLORS, perm))}  length {L[sa, sb].sum():.0f}, wraps {WR[sa, sb].sum()}; start = {S[f[START_NODE]]}'
      + ''.join(f'\n  {x}' for x in left), file=sys.stderr)

# ---- output (display colors come from color_of: a consistent renaming of the slot colors)
place = {nodes[v]: S[f[v]] for v in range(n)}
q = lambda s: json.dumps(s).replace('"', "'") if "'" not in s else json.dumps(s)
C_PLACES, C_EDGES, C_SLOTS = cfg['const']
out = [f'  const {C_PLACES} = {{']
for k, c in enumerate(COLORS):
    reg = perm[k]
    for v in sorted(byColor[c], key=lambda v: P[f[v]][0]):
        s = S[f[v]]; x, y = P[f[v]]
        extra = ''
        if s in cfg.get('info', {}):
            region, zh = cfg['info'][s]; extra = f", region: {q(region)}, zh: '{zh}'"
        out.append(f"    {q(s)}: {{ color: '{cfg['color_of'][reg]}', x: {x:.0f}, y: {y:.0f}, lat: {PLACES[s][0]}, lon: {PLACES[s][1]}{extra} }},")
    if k < 3: out.append('')
out.append(f'  }};\n  const {C_EDGES} = [')
edges = [f'[{q(place[a])}, {q(place[b])}]' for a, b in O['E']]
out += ['    ' + ', '.join(edges[i:i + 4]) + ',' for i in range(0, len(edges), 4)]
out.append(f"  ];\n  // Which city's slot each place takes (checked by test/rules.js; not used by the game).")
out.append(f'  const {C_SLOTS} = ' + json.dumps({place[v]: v for v in nodes}, ensure_ascii=False) + ';')
block = '\n'.join(out)
if '--write' in sys.argv:
    path = f'{ROOT}/public/shared/data.js'; s = open(path).read()
    m = re.search(rf'  const {C_PLACES} = \{{.*?\n  const {C_SLOTS} = .*?\n', s, re.S)
    if not m: sys.exit(f'{C_PLACES}..{C_SLOTS} block not found in data.js: add an empty one first')
    open(path, 'w').write(s[:m.start()] + block + '\n' + s[m.end():])
    print(f'wrote {path} (start = {S[f[START_NODE]]})', file=sys.stderr)
else:
    print(block)
