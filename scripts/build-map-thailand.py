#!/usr/bin/env python3
"""Génère src/_data/mapThailand.js à partir de Natural Earth (admin 0, 1:50m).

Usage : python3 -I scripts/build-map-thailand.py <ne_50m_admin_0_countries.geojson>

Source : https://github.com/nvkelso/natural-earth-vector (geojson/ne_50m_admin_0_countries.geojson),
domaine public. Projection Web Mercator, simplification Douglas-Peucker du continent,
îles conservées telles quelles (Phuket, Koh Samui, Koh Phangan, Koh Lanta, Koh Chang, Tarutao…).
"""
import json, math, sys

HEIGHT = 600.0          # hauteur du viewBox en unités SVG
MARGIN = 0.02           # marge autour du tracé (fraction de la hauteur)
TOLERANCE = 0.9         # Douglas-Peucker, en unités SVG (environ 0,025°)

def merc_y(lat):
    return math.degrees(math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))

def dp(points, tol):
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy)
    idx, dmax = 0, 0.0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        # anneau fermé (premier point = dernier) : distance au point de départ
        d = math.hypot(px - x1, py - y1) if norm < 1e-9 else abs(dy * px - dx * py + x2 * y1 - y2 * x1) / norm
        if d > dmax:
            idx, dmax = i, d
    if dmax > tol:
        return dp(points[:idx + 1], tol)[:-1] + dp(points[idx:], tol)
    return [points[0], points[-1]]

src = sys.argv[1]
data = json.load(open(src))
feat = next(f for f in data["features"] if f["properties"].get("ADMIN") == "Thailand")
rings = [p[0] for p in feat["geometry"]["coordinates"]]
rings.sort(key=len, reverse=True)

lons = [c[0] for r in rings for c in r]
lats = [c[1] for r in rings for c in r]
lon0, lon1 = min(lons), max(lons)
my0, my1 = merc_y(max(lats)), merc_y(min(lats))     # haut puis bas
scale = HEIGHT * (1 - 2 * MARGIN) / (my0 - my1)
width = (lon1 - lon0) * scale + 2 * MARGIN * HEIGHT

def project(lon, lat):
    return ((lon - lon0) * scale + MARGIN * HEIGHT, (my0 - merc_y(lat)) * scale + MARGIN * HEIGHT)

paths = []
for k, ring in enumerate(rings):
    pts = [project(lon, lat) for lon, lat in ring]
    if k == 0:
        pts = dp(pts, TOLERANCE)
    d = "M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in pts[:-1]) + "Z"
    paths.append(d)

path = "".join(paths)
out = f"""// Généré par scripts/build-map-thailand.py, ne pas éditer à la main.
// Source : Natural Earth 1:50m admin 0 (domaine public), github.com/nvkelso/natural-earth-vector,
// geojson/ne_50m_admin_0_countries.geojson, entité ADMIN = Thailand ({len(rings)} anneaux,
// continent simplifié par Douglas-Peucker à {TOLERANCE} unité SVG, îles conservées).
// Projection Web Mercator : x = (lon - lon0) * scale + m, y = (mercY0 - mercY(lat)) * scale + m.
const LON0 = {lon0!r};
const MERC_Y0 = {my0!r};
const SCALE = {scale!r};
const M = {MARGIN * HEIGHT!r};
const W = {width:.2f};
const H = {HEIGHT:.2f};

function mercY(lat) {{
  return (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) / Math.PI;
}}

// Coordonnées SVG et pourcentages du viewBox pour un point GPS.
function project(lat, lon) {{
  const x = (lon - LON0) * SCALE + M;
  const y = (MERC_Y0 - mercY(lat)) * SCALE + M;
  return {{ x, y, px: (x / W) * 100, py: (y / H) * 100 }};
}}

module.exports = {{
  width: W,
  height: H,
  viewBox: `0 0 ${{W}} ${{H}}`,
  path: {json.dumps(path)},
  project
}};
"""
open("src/_data/mapThailand.js", "w").write(out)
print(f"viewBox 0 0 {width:.2f} {HEIGHT:.2f}, {len(rings)} anneaux, path {len(path)} octets, continent {paths[0].count('L')+1} points")
