"""
Bakes the night-safety street graph into a static JSON the web app loads.

Why offline: the exposure model is the expensive part (hundreds of Dijkstras).
It only changes when the map area changes, so it runs here once and ships as a
file. That means the live app needs no Python at all.

Area: Manipal University Jaipur, Dehmi Kalan (Bagru), Jaipur.

The campus is mapped in unusual detail by its own students -- hostel blocks,
academic blocks, the mess, the food courts, the subway underpass are all named
in OpenStreetMap. That lets the trip model be literal rather than statistical:
a night trip on this campus is somebody walking from their hostel block to the
library, the mess, or an academic block. We route exactly those.

Run:  python precompute.py
Out:  ../web/src/data/graph.json
"""

from __future__ import annotations

import json
import math
import os
import random
import re
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from heapq import heappop, heappush

BBOX = "26.835,75.554,26.851,75.572"
AREA_NAME = "Manipal University Jaipur, Dehmi Kalan"

OVERPASS = "https://overpass-api.de/api/interpreter"
OUT = os.path.join(os.path.dirname(__file__), "..", "web", "src", "data", "graph.json")
CAMPUS_DATA = os.path.join(os.path.dirname(__file__), "..", "docs", "campus-data.json")

WALKABLE = (
    "residential|tertiary|secondary|primary|unclassified|living_street|"
    "footway|path|pedestrian|service|steps|track"
)

# Sports facilities are named after the block they sit behind ("B1 Basketball
# Court"), so they match the hostel pattern. Filter them first or the model
# treats a badminton court as a place students sleep.
SPORTS_RE = re.compile(
    r"badminton|basketball|volleyball|futsal|tennis|cricket|boxing|mma|"
    r"swimming|jogging|court\b|ground\b|pool\b",
    re.I,
)

# Where students sleep. These are the origins of almost every night trip.
HOSTEL_RE = re.compile(r"^(b\d|g\d)\b|hostel|ghs|boy'?s block|girl'?s block", re.I)

# Where they walk TO after dark.
DEST_RE = re.compile(
    r"librar|food.?court|mess|canteen|baba|zanak|auditorium|ab\d|academic|"
    r"faculty block|administrat|gym|entrance|subway|amphitheat",
    re.I,
)

# Noise: infrastructure and surface markings that are named but nobody visits.
SKIP_RE = re.compile(
    r"solar|biogas|water treatment|chiller|panel|footway|corridor|footpath|"
    r"^main road$|campus road|assembly point|selfie|parking|track|stairs|road$",
    re.I,
)

# Origins sampled across the campus in addition to the hostel blocks, so paths
# people take from anywhere are represented and the surface is not degenerate.
N_ORIGINS = 250
NEAREST_K = 3

# Probability a street is unlit, by road class. Seeded per-street because real
# outages take out whole roads. NOT uniform: campus arterials and the main
# approach road are maintained; the service lanes behind the hostel blocks and
# the unlit footpaths across the grounds are where the gaps actually are.
DARK_BY_CLASS = {
    "primary": 0.05,
    "secondary": 0.10,
    "tertiary": 0.20,
    "residential": 0.30,
    "living_street": 0.40,
    "unclassified": 0.45,
    "service": 0.50,
    "pedestrian": 0.40,
    "footway": 0.65,
    "path": 0.75,
    "steps": 0.60,
    "track": 0.80,
}
DARK_DEFAULT = 0.40


def overpass(query: str, tries: int = 4) -> dict:
    for i in range(tries):
        try:
            data = urllib.parse.urlencode({"data": query}).encode()
            req = urllib.request.Request(
                OVERPASS, data=data, headers={"User-Agent": "night-safety-mapper/mvp"}
            )
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # 429/504 from the public instance are routine
            print(f"    overpass retry {i + 1} ({str(e)[:44]})")
            time.sleep(25)
    raise SystemExit("overpass unavailable")


def haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    R = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dphi = p2 - p1
    dlam = math.radians(b[1] - a[1])
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def nkey(lat: float, lon: float) -> tuple[float, float]:
    """~1m grid snap. Without this, ways that visually meet stay disconnected."""
    return (round(lat, 5), round(lon, 5))


def fetch_all() -> tuple[list[dict], list[dict]]:
    """One request for streets and one for named places, to stay under rate limits."""
    streets = overpass(
        f'[out:json][timeout:170];(way[highway~"^({WALKABLE})$"]({BBOX}););out body geom;'
    )["elements"]
    time.sleep(8)
    places = overpass(
        f"""[out:json][timeout:170];
(node[name]({BBOX});way[name]({BBOX});relation[name]({BBOX}););
out center tags;"""
    )["elements"]
    return streets, places


def classify(name: str, tags: dict) -> str | None:
    """hostel | dest | None. Name-driven, because campus tagging is inconsistent."""
    if SKIP_RE.search(name) or SPORTS_RE.search(name):
        return None
    if HOSTEL_RE.search(name):
        return "hostel"
    amenity = tags.get("amenity", "")
    if amenity in ("library", "food_court", "restaurant", "cafe", "fast_food", "theatre"):
        return "dest"
    if DEST_RE.search(name):
        return "dest"
    return None


def build_graph(ways: list[dict]):
    adj: dict = defaultdict(list)
    edges: dict = {}
    for w in ways:
        geom = w.get("geometry") or []
        tags = w.get("tags") or {}
        for a, b in zip(geom, geom[1:]):
            ka, kb = nkey(a["lat"], a["lon"]), nkey(b["lat"], b["lon"])
            if ka == kb:
                continue
            ek = (ka, kb) if ka < kb else (kb, ka)
            if ek in edges:
                continue
            edges[ek] = {
                "length": haversine(ka, kb),
                "lit_tag": tags.get("lit"),
                "name": tags.get("name"),
                "highway": tags.get("highway", "service"),
                "wid": w["id"],
            }
            adj[ka].append(kb)
            adj[kb].append(ka)
    return adj, edges


def largest_component(adj: dict) -> set:
    seen, best = set(), set()
    for start in adj:
        if start in seen:
            continue
        stack, comp = [start], set()
        while stack:
            n = stack.pop()
            if n in comp:
                continue
            comp.add(n)
            stack.extend(m for m in adj[n] if m not in comp)
        seen |= comp
        if len(comp) > len(best):
            best = comp
    return best


def dijkstra(adj, edges, src):
    dist = {src: 0.0}
    prev: dict = {}
    pq = [(0.0, src)]
    while pq:
        d, u = heappop(pq)
        if d > dist.get(u, float("inf")):
            continue
        for v in adj[u]:
            ek = (u, v) if u < v else (v, u)
            nd = d + edges[ek]["length"]
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                prev[v] = u
                heappush(pq, (nd, v))
    return dist, prev


def walk_back(prev, tgt, usage, weight=1.0):
    cur = tgt
    while cur in prev:
        nxt = prev[cur]
        ek = (cur, nxt) if cur < nxt else (nxt, cur)
        usage[ek] += weight
        cur = nxt


def nearest_node(nodes, pt):
    best, bd = None, float("inf")
    for n in nodes:
        d = (n[0] - pt[0]) ** 2 + (n[1] - pt[1]) ** 2
        if d < bd:
            bd, best = d, n
    return best


def load_campus_data() -> dict:
    """Local ground truth OSM does not carry. Absent or malformed is not fatal."""
    empty = {"blocked": [], "lighting": [], "landmarks": [], "emergency": []}
    try:
        with open(CAMPUS_DATA, encoding="utf-8") as f:
            raw = json.load(f)
    except FileNotFoundError:
        return empty
    except json.JSONDecodeError as e:
        print(f"  !! campus-data.json is not valid JSON ({e}) -- ignoring it")
        return empty

    out = {}
    for key in empty:
        items = raw.get(key) or []
        # `enabled: false` is how the example rows stay in the file harmlessly.
        out[key] = [i for i in items if isinstance(i, dict) and i.get("enabled", True)]
    return out


def way_at(edges, pt, max_m=60.0):
    """The way id of the segment nearest to a point, or None if nothing is close."""
    best, bd = None, float("inf")
    for (a, b), e in edges.items():
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        d = haversine(mid, pt)
        if d < bd:
            bd, best = d, e["wid"]
    return best if bd <= max_m else None


def main() -> None:
    t0 = time.time()
    print(f"area: {AREA_NAME}\n      {BBOX}")

    campus = load_campus_data()
    ways, places = fetch_all()
    print(f"  ways              {len(ways)}")
    adj, edges = build_graph(ways)
    raw = len(adj)

    # BLOCKED PATHS, applied before anything else.
    #
    # A locked gate is not a routing preference, it is a wall: the path must
    # leave the graph entirely. Doing it here rather than at query time also
    # means the exposure model reroutes around it, so foot traffic lands where
    # people really walk instead of through a door that is shut at 10pm.
    if campus["blocked"]:
        drop = set()
        for b in campus["blocked"]:
            wid = way_at(edges, (b["lat"], b["lng"]))
            if wid is None:
                print(f"  !! blocked entry at {b['lat']},{b['lng']} matched no path -- skipped")
                continue
            drop.add(wid)
        if drop:
            edges = {k: v for k, v in edges.items() if v["wid"] not in drop}
            adj = defaultdict(list)
            for (a, b) in edges:
                adj[a].append(b)
                adj[b].append(a)
            print(f"  blocked           {len(drop)} path(s) removed from the graph")

    comp = largest_component(adj)
    adj = {n: [m for m in adj[n] if m in comp] for n in comp}
    edges = {k: v for k, v in edges.items() if k[0] in comp and k[1] in comp}
    nodes = list(comp)
    print(f"  nodes / edges     {len(nodes)} / {len(edges)}  ({100 * len(nodes) // raw}% of raw)")

    # Landmarks straight out of OSM, so every place name on the map is one a
    # student actually uses. Nothing here is invented.
    hostels: dict = {}
    dests: dict = {}
    for e in places:
        tags = e.get("tags") or {}
        name = (tags.get("name") or "").strip()
        if not name:
            continue
        kind = classify(name, tags)
        if not kind:
            continue
        c = e.get("center") or {"lat": e.get("lat"), "lon": e.get("lon")}
        if c.get("lat") is None:
            continue
        n = nearest_node(nodes, (c["lat"], c["lon"]))
        if not n or haversine(n, (c["lat"], c["lon"])) > 220:
            continue
        (hostels if kind == "hostel" else dests)[name] = n

    # Landmarks OSM is missing, supplied by people who actually study here.
    for lm in campus["landmarks"]:
        n = nearest_node(nodes, (lm["lat"], lm["lng"]))
        if not n:
            continue
        (hostels if lm.get("kind") == "hostel" else dests)[lm["name"]] = n
    if campus["landmarks"]:
        print(f"  campus landmarks  +{len(campus['landmarks'])} from campus-data.json")

    print(f"  landmarks         {len(hostels)} hostel blocks, {len(dests)} destinations")
    print(f"    hostels: {', '.join(sorted(hostels)[:9])}")
    print(f"    dests  : {', '.join(sorted(dests)[:9])}")

    # EXPOSURE. A night trip on this campus is a student leaving their hostel
    # block for the library, the mess, a food court or an academic block, and
    # walking back. We route every hostel to every destination and count how
    # often each segment is used. Hostel trips are weighted 3x destination-to-
    # destination trips because that is the dominant night movement.
    t = time.time()
    usage: dict = defaultdict(float)
    trips = 0
    for h in hostels.values():
        _, prev = dijkstra(adj, edges, h)
        for d in dests.values():
            if d in prev:
                walk_back(prev, d, usage, 3.0)
                trips += 1
    for a in dests.values():
        _, prev = dijkstra(adj, edges, a)
        for b in dests.values():
            if a != b and b in prev:
                walk_back(prev, b, usage, 1.0)
                trips += 1

    # Plus trips starting from anywhere on campus, not only the hostel blocks --
    # otherwise only the handful of hostel-to-block corridors carry any weight
    # and the rest of the network reads as though nobody ever walks it.
    rng_o = random.Random(23)
    for src in rng_o.sample(nodes, min(N_ORIGINS, len(nodes))):
        dist, prev = dijkstra(adj, edges, src)
        near = sorted((d for d in dests.values() if d in dist and d != src),
                      key=lambda d: dist[d])[:NEAREST_K]
        for d in near:
            walk_back(prev, d, usage, 1.0)
            trips += 1

    print(f"  exposure model    {time.time() - t:.1f}s over {trips} modelled trips")

    mx = max(usage.values()) if usage else 1.0
    for ek in edges:
        edges[ek]["exposure"] = round(usage.get(ek, 0.0) / mx, 4)

    # LABELS: real street name if OSM has one, else the road type plus the
    # nearest landmark. A repair queue is read by a human, so "Footpath by
    # Central Library" has to beat "way 41028873".
    friendly = {
        "path": "Footpath",
        "footway": "Footpath",
        "steps": "Steps",
        "service": "Service road",
        "residential": "Road",
        "pedestrian": "Walkway",
        "living_street": "Lane",
        "unclassified": "Road",
        "track": "Track",
        "tertiary": "Road",
        "secondary": "Road",
        "primary": "Main road",
    }
    all_marks = {**hostels, **dests}
    for ek, e in edges.items():
        if e["name"] and not SKIP_RE.search(e["name"]):
            e["label"] = e["name"]
        else:
            mid = ((ek[0][0] + ek[1][0]) / 2, (ek[0][1] + ek[1][1]) / 2)
            near = min(all_marks.items(), key=lambda kv: haversine(kv[1], mid)) if all_marks else None
            hw = friendly.get(e["highway"], e["highway"].replace("_", " ").capitalize())
            e["label"] = f"{hw} by {near[0]}" if near else hw

    # LIGHTING: real OSM `lit` tags where they exist -- this campus has a
    # handful, unlike Chandigarh which had none. Everything else is seeded and
    # flagged `simulated` so the UI can be honest about provenance.
    # Surveyed ground truth outranks both OSM and the seed: somebody walked
    # this path at night and looked.
    surveyed: dict = {}
    for s in campus["lighting"]:
        wid = way_at(edges, (s["lat"], s["lng"]))
        if wid is None:
            print(f"  !! lighting entry at {s['lat']},{s['lng']} matched no path -- skipped")
            continue
        surveyed[wid] = 1.0 if s.get("lit") else 0.0

    rng = random.Random(17)
    street_dark: dict = {}
    real = sim = 0
    surv = 0
    for e in edges.values():
        if e["wid"] in surveyed:
            e["lit"] = surveyed[e["wid"]]
            e["src"] = "survey"
            surv += 1
        elif e["lit_tag"] in ("yes", "no"):
            e["lit"] = 1.0 if e["lit_tag"] == "yes" else 0.0
            e["src"] = "osm"
            real += 1
        else:
            k = e["wid"]
            if k not in street_dark:
                street_dark[k] = rng.random() < DARK_BY_CLASS.get(e["highway"], DARK_DEFAULT)
            e["lit"] = 0.0 if street_dark[k] else 1.0
            e["src"] = "simulated"
            sim += 1
        e["risk"] = round(e["exposure"] * (1.0 - e["lit"]), 4)

    print(f"  lighting          {surv} surveyed, {real} from OSM, {sim} simulated")
    covered = sum(1 for e in edges.values() if e["exposure"] > 0)
    print(f"  exposure coverage {covered}/{len(edges)} ({100 * covered // len(edges)}%)")

    nid = {n: i for i, n in enumerate(nodes)}
    landmarks = (
        [{"name": k, "node": nid[v], "kind": "hostel"} for k, v in sorted(hostels.items())]
        + [{"name": k, "node": nid[v], "kind": "dest"} for k, v in sorted(dests.items())]
    )

    out = {
        "meta": {
            "bbox": BBOX,
            "area": AREA_NAME,
            "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "hostels": len(hostels),
            "destinations": len(dests),
            "trips": trips,
            "lit_surveyed": surv,
            "lit_from_osm": real,
            "lit_simulated": sim,
            "blocked_paths": len(campus["blocked"]),
            "emergency": campus["emergency"],
            "dark_by_class": DARK_BY_CLASS,
            "total_km": round(sum(e["length"] for e in edges.values()) / 1000, 1),
        },
        "nodes": [[round(n[0], 5), round(n[1], 5)] for n in nodes],
        "landmarks": landmarks,
        # [a, b, length_m, exposure, lit, risk, wid, label, source]
        "edges": [
            [
                nid[a], nid[b], round(e["length"], 1), e["exposure"],
                e["lit"], e["risk"], e["wid"], e["label"], e["src"],
            ]
            for (a, b), e in edges.items()
        ],
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"\nwrote {os.path.relpath(OUT)}  ({os.path.getsize(OUT) // 1024} KB)  in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
