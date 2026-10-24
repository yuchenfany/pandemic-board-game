#!/usr/bin/env python3
"""Plans the universities board: where each school sits and which city slot it takes.

The board must play exactly like the cities board, so it reuses the cities board's graph: every
school takes one city's slot (its color and connections). This script picks that assignment so that

  * each color is one region (REGIONS below, 12 schools each), and
  * connected schools are close together, with few crossing or wrap-around (coast-to-coast) links.

Steps: real lat/lon -> stylised board positions (squeezes the empty Mountain West, spreads out dense
metros like Boston and LA), then simulated annealing over the assignment for each region->color
mapping. It prints the UNIVERSITIES / UNIVERSITY_EDGES / UNIVERSITY_SLOTS blocks for
public/shared/data.js (the start school is whichever lands in Austin's slot; update BOARDS.start).
Labels that overlapped are fixed with NUDGE (before layout) and FIX (after layout).
After changing positions, regenerate the background: node tools/build-worldmap.js universities

Usage: python3 tools/plan-universities.py [seeds=6] [steps=200000]   (needs numpy and node; takes a few minutes)
"""
import itertools, json, math, os, subprocess, sys
import numpy as np

SCHOOLS = {  # name: (lat, lon)
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
}
REGIONS = {
    'west': ['UW', 'UC Berkeley', 'Stanford', 'UCSF', 'UCD', 'UCSB', 'UCLA', 'USC', 'Caltech', 'UCI', 'UCSD', 'Scripps'],
    'north/midwest': ['UBC', 'Utah', 'CU Boulder', 'UMinnesota', 'UWisconsin', 'WashU', 'UIUC', 'UChicago', 'Northwestern', 'Purdue', 'Indiana', 'UMich'],
    'south': ['UT Austin', 'Texas A&M', 'Rice', 'UTSW', 'Vanderbilt', 'Emory', 'Georgia Tech', 'Duke', 'UNC', 'Virginia Tech', 'UMaryland', 'JHU'],
    'northeast': ['CMU', 'UToronto', 'McGill', 'UPenn', 'Princeton', 'Columbia', 'NYU', 'Cornell Tech', 'Cornell', 'Yale', 'Harvard', 'MIT'],
}
W, H = 1240, 660
GRAZE = 24  # px: a link closer than this to another school's center looks like it passes through it
NUDGE = {'Utah': (0, 55)}  # extra offsets to the target positions, in px
FIX = {'Virginia Tech': (878, 404), 'UMaryland': (1006, 392), 'USC': (300, 500), 'Stanford': (168, 288),
       'UCI': (400, 425), 'UCSD': (445, 485), 'Cornell': (998, 185), 'Emory': (872, 536)}  # final positions forced after layout (labels, links passing over schools)
COLOR_OF = {'west': 'blue', 'south': 'red', 'north/midwest': 'black', 'northeast': 'yellow'}  # display colors
WRAP_COST, CROSS_COST, NEAR_COST = 250, 120, 400  # per wrap-around link / crossing pair / link passing over a school

# ---- cities board graph (from data.js)
src = "const D=require('./public/shared/data');console.log(JSON.stringify({C:D.BOARDS.cities.cities,E:D.BOARDS.cities.edges}))"
O = json.loads(subprocess.check_output(['node', '-e', src], cwd=__file__.rsplit('/tools/', 1)[0]))
nodes = list(O['C']); col = [O['C'][v]['color'] for v in nodes]
E = [(nodes.index(a), nodes.index(b)) for a, b in O['E']]
assert len(SCHOOLS) == len(nodes) == 48 and sorted(sum(REGIONS.values(), [])) == sorted(SCHOOLS)

# ---- layout: piecewise-linear lon/lat -> board, then push apart to >= 76px
S = list(SCHOOLS); n = len(S)
lat = np.array([SCHOOLS[s][0] for s in S]); lon = np.array([SCHOOLS[s][1] for s in S])
# x: California gets the room the near-empty Mountain time zone doesn't need. y: the West Coast is
# raised and stretched so its 11 California schools spread out.
west = lon < -114
T = np.stack([np.interp(lon, [-124, -117, -110, -105, -93, -84, -76, -71], [45, 430, 470, 530, 660, 840, 1015, 1190]),
              np.where(west, np.interp(lat, [32.5, 34, 38.5, 47.7, 49.3], [500, 420, 260, 95, 40]),
                       np.interp(lat, [29.5, 33, 38, 42, 45.6, 49.3], [625, 545, 390, 215, 110, 45]))], 1)
T += np.array([NUDGE.get(s, (0, 0)) for s in S])
P = T + np.random.default_rng(0).normal(0, 1, T.shape)
for _ in range(5000):
    d = P[:, None] - P[None]; r = np.linalg.norm(d, axis=2) + np.eye(n) * 1e9
    P += (np.clip(76 - r, 0, None)[:, :, None] * d / r[:, :, None]).sum(1) * 0.25 + (T - P) * 0.015
    P[:, 0] = np.clip(P[:, 0], 40, W - 40); P[:, 1] = np.clip(P[:, 1], 38, H - 30)
for name, xy in FIX.items(): P[S.index(name)] = xy
P = P.round()

# ---- geometry of every possible link (drawn across the map edge when that is shorter, like the Pacific)
def segs(i, j):
    a, b = P[i], P[j]
    if abs(a[0] - b[0]) <= W / 2: return [(a, b)], float(np.linalg.norm(a - b)), False
    w, e = (a, b) if a[0] < b[0] else (b, a)
    return [(w, e - [W, 0]), (e, w + [W, 0])], float(np.linalg.norm(w - (e - [W, 0]))), True
def crosses(p1, p2, p3, p4):
    o = lambda a, b, c: (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    return o(p1, p2, p3) * o(p1, p2, p4) < 0 and o(p3, p4, p1) * o(p3, p4, p2) < 0
pairs = [(i, j) for i in range(n) for j in range(i + 1, n)]
PID = np.full((n, n), -1); G = {}; L = np.zeros((n, n)); WR = np.zeros((n, n), bool)
for k, (i, j) in enumerate(pairs):
    PID[i, j] = PID[j, i] = k
    G[k], L[i, j], WR[i, j] = segs(i, j); L[j, i], WR[j, i] = L[i, j], WR[i, j]
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

# ---- anneal: swaps within a color only, so every region keeps its color
colors = ['blue', 'yellow', 'black', 'red']; byColor = {c: [v for v in range(n) if col[v] == c] for c in colors}
seeds = int(sys.argv[1]) if len(sys.argv) > 1 else 6; steps = int(sys.argv[2]) if len(sys.argv) > 2 else 200000
def anneal(perm, seed, budget):
    rng = np.random.default_rng(seed)
    f = np.zeros(n, int)
    for c, reg in zip(colors, perm):
        sch = [S.index(x) for x in REGIONS[reg]]; rng.shuffle(sch); f[byColor[c]] = sch
    cur = cost(f)
    for t in range(budget):
        temp = 300 * 0.003 ** (t / budget)
        u, v = rng.choice(byColor[colors[rng.integers(4)]], 2, replace=False)
        f[u], f[v] = f[v], f[u]; c2 = cost(f)
        if c2 < cur or rng.random() < math.exp((cur - c2) / temp): cur = c2
        else: f[u], f[v] = f[v], f[u]
    return cur, perm, f
# Quick pass to pick which color goes to which region, then several full runs of the winner.
# SLOTS fixes which slot color each region takes, in the order blue, yellow, black, red of the
# cities board. The region in blue's slots gets the start (Austin's slot). The automatic choice is a
# short trial per mapping, so it can miss the best one; this default gave 0 crossings.
SLOTS = os.environ.get('SLOTS', 'south,north/midwest,northeast,west')  # SLOTS='' lets the script choose
perm = tuple(SLOTS.split(',')) if SLOTS else \
    min((anneal(p, 0, steps // 4) for p in itertools.permutations(REGIONS)), key=lambda r: r[0])[1]
cur, perm, f = min((anneal(perm, s, steps) for s in range(seeds)), key=lambda r: r[0])
sa, sb = f[Ea], f[Eb]; pid = PID[sa, sb]
print(f'// {dict(zip(colors, perm))}  cost {cur:.0f}: length {L[sa, sb].sum():.0f}, wraps {WR[sa, sb].sum()}, '
      f'crossings {X[np.ix_(pid, pid)].sum() // 2}, grazes {NEAR[pid].sum():.0f}; start = {S[f[nodes.index("Austin")]]}', file=sys.stderr)

school = {nodes[v]: S[f[v]] for v in range(n)}
# Display colors come from COLOR_OF (a consistent renaming of the slot colors, so the game is unchanged).
print('  const UNIVERSITIES = {')
for k, c in enumerate(colors):
    reg = perm[k]
    for v in sorted(byColor[c], key=lambda v: P[f[v]][0]):
        s = S[f[v]]; x, y = P[f[v]]
        print(f"    '{s}': {{ color: '{COLOR_OF[reg]}', x: {x:.0f}, y: {y:.0f}, lat: {SCHOOLS[s][0]}, lon: {SCHOOLS[s][1]} }},")
    if k < 3: print()
print('  };\n  const UNIVERSITY_EDGES = [')
edges = [f"['{school[a]}', '{school[b]}']" for a, b in O['E']]
for i in range(0, len(edges), 4): print('    ' + ', '.join(edges[i:i + 4]) + ',')
print('  ];\n  const UNIVERSITY_SLOTS = ' + json.dumps({school[v]: v for v in nodes}) + ';')
