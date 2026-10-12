# 사이버 홍대입구 - 롯데시네마 홍대입구 10층 & 4관(광음시네마) 절차적 생성 스크립트
#
# 실행:  blender -b -P build_cinema.py -- [--render]
# 결과:  ../client/assets/map/cinema.glb, ./cinema.blend, (옵션) ./preview_*.png
#
# 좌표계(평면도 기준): u = 동쪽(+), v = 남쪽(+), z = 위.  평면도 손그림 1px = 7.5cm
# Blender:  X = u, Y = -v, Z = z   →  glTF/three.js:  x = u, y = z, z = v
#
# glTF extras(userData) 규칙 (클라이언트가 읽음)
#   collide=1   : 캐릭터 충돌체          floor=1 : 걸을 수 있는 바닥(높이 판정)
#   invisible=1 : 렌더링하지 않는 충돌체   seat=<id>, row, num, yaw : 좌석 착석 지점
#   light=point|spot ... : 조명 배치 지점     zone=<name> : 영역(박스 크기 = scale)
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, "textures")
TEX_AI = os.path.join(HERE, "textures_ai")
OUT_GLB = os.path.normpath(os.path.join(HERE, "..", "client", "assets", "map", "cinema.glb"))
OUT_BLEND = os.path.join(HERE, "cinema.blend")
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

S = 0.075  # 평면도 px → m


def U(px):
    return (px - 95) * S


def V(py):
    return (py - 40) * S


# ---------------------------------------------------------------- 기본 세팅
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
COL = bpy.data.collections.new("Cinema")
scene.collection.children.link(COL)


def tex_path(name):
    """AI 텍스처(textures_ai)가 있으면 우선 사용, 없으면 절차 텍스처."""
    for d in (TEX_AI, TEX):
        p = os.path.join(d, name)
        if os.path.exists(p):
            return p
    return None


# ---------------------------------------------------------------- 머티리얼
MATS = {}
TILE = {}  # 머티리얼 이름 → 텍스처 1장이 덮는 실제 크기(m), UV 계산용


def make_mat(name, color=(0.5, 0.5, 0.5), tex=None, tile=2.0, rough=0.6, metal=0.0,
             emit=None, emit_strength=1.0, emit_tex=False, alpha=1.0, alpha_tex=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    img_node = None
    if tex:
        p = tex_path(tex) if not os.path.isabs(tex) else tex
        if p:
            img_node = nt.nodes.new("ShaderNodeTexImage")
            img_node.image = bpy.data.images.load(p, check_existing=True)
            nt.links.new(img_node.outputs["Color"], bsdf.inputs["Base Color"])
            if alpha_tex:
                nt.links.new(img_node.outputs["Alpha"], bsdf.inputs["Alpha"])
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
        if emit_tex and img_node:
            nt.links.new(img_node.outputs["Color"], bsdf.inputs["Emission Color"])
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
    if alpha < 1.0 or alpha_tex:
        if hasattr(m, "surface_render_method"):
            m.surface_render_method = "BLENDED"
        if hasattr(m, "blend_method"):
            m.blend_method = "BLEND"
    MATS[name] = m
    TILE[name] = tile
    return m


make_mat("floor_dark", tex="floor_dark.jpg", tile=2.4, rough=0.25)
make_mat("floor_wood", tex="floor_wood.jpg", tile=2.4, rough=0.35)
make_mat("carpet", tex="carpet_ai.jpg" if tex_path("carpet_ai.jpg") else "carpet.jpg", tile=2.0, rough=0.95)
make_mat("carpet_dark", tex="carpet_dark.jpg", tile=2.0, rough=0.95)
make_mat("wall_stone", tex="wall_stone_ai.jpg" if tex_path("wall_stone_ai.jpg") else "wall_stone.jpg", tile=2.4, rough=0.7)
make_mat("wall_theater", tex="theater_wall_ai.jpg" if tex_path("theater_wall_ai.jpg") else "wall_theater.jpg", tile=2.0, rough=0.9)
make_mat("wall_dark", color=(0.035, 0.035, 0.04), rough=0.8)
make_mat("wall_charcoal", color=(0.09, 0.09, 0.1), rough=0.7)
make_mat("wall_white", color=(0.8, 0.8, 0.78), rough=0.6)
make_mat("ceiling_dark", color=(0.02, 0.02, 0.022), rough=0.9)
make_mat("ceiling_gray", color=(0.12, 0.12, 0.13), rough=0.9)
make_mat("black_plastic", color=(0.02, 0.02, 0.02), rough=0.4)
make_mat("metal", color=(0.6, 0.6, 0.62), rough=0.3, metal=1.0)
make_mat("steel_dark", color=(0.15, 0.15, 0.16), rough=0.35, metal=1.0)
make_mat("wood", tex="wood.jpg", tile=1.5, rough=0.5)
make_mat("seat_fabric", tex="seat_fabric.jpg", tile=0.6, rough=0.9)
make_mat("seat_logo", tex="seat_logo.jpg", tile=1.0, rough=0.9)
make_mat("glass", color=(0.6, 0.75, 0.85), rough=0.05, alpha=0.18)
make_mat("screen", color=(0.9, 0.9, 0.9), rough=1.0, emit=(0.05, 0.05, 0.06), emit_strength=1.0)
make_mat("led_black", color=(0.0, 0.0, 0.0), rough=0.3, emit=(0.02, 0.02, 0.05), emit_strength=1.0)
make_mat("emit_white", color=(1, 1, 1), emit=(1.0, 0.97, 0.9), emit_strength=4.0)
make_mat("emit_warm", color=(1, 0.8, 0.5), emit=(1.0, 0.72, 0.4), emit_strength=3.0)
make_mat("emit_purple", color=(0.6, 0.3, 1), emit=(0.55, 0.25, 1.0), emit_strength=6.0)
make_mat("emit_green", color=(0.2, 1, 0.5), emit=(0.15, 1.0, 0.45), emit_strength=3.0)
make_mat("emit_blue", color=(0.3, 0.5, 1), emit=(0.3, 0.55, 1.0), emit_strength=3.0)
make_mat("emit_step", color=(1, 0.8, 0.5), emit=(1.0, 0.75, 0.45), emit_strength=2.0)
make_mat("red_box", color=(0.7, 0.04, 0.04), rough=0.4)
make_mat("brick", color=(0.32, 0.22, 0.17), rough=0.8)
make_mat("blue_seat_shell", color=(0.08, 0.16, 0.42), rough=0.5)
make_mat("baby_seat", color=(0.15, 0.35, 0.8), rough=0.5)
make_mat("kiosk_body", color=(0.92, 0.92, 0.93), rough=0.3)
make_mat("kiosk_red", color=(0.75, 0.05, 0.08), rough=0.35)
make_mat("invisible", color=(1, 0, 1), alpha=0.0)
# 텍스처 사인(발광)
make_mat("sign_sweet", tex="sign_sweet.jpg", emit=(1, 1, 1), emit_strength=2.5, emit_tex=True)
make_mat("menu_boards", tex="menu_boards_ai.png" if tex_path("menu_boards_ai.png") else "menu_boards.jpg", emit=(1, 1, 1), emit_strength=1.4, emit_tex=True)
make_mat("sign_lotte", tex="sign_lotte.png", alpha_tex=True, emit=(1, 1, 1), emit_strength=1.5, emit_tex=True)
make_mat("sign_exit", tex="sign_exit.jpg", emit=(1, 1, 1), emit_strength=2.0, emit_tex=True)
make_mat("kiosk_screens", tex="kiosk_screens.jpg", emit=(1, 1, 1), emit_strength=1.2, emit_tex=True)
make_mat("posters", tex="posters_ai.jpg" if tex_path("posters_ai.jpg") else "posters.jpg", emit=(1, 1, 1), emit_strength=0.9, emit_tex=True)
make_mat("city_night", tex="city_night_ai.jpg" if tex_path("city_night_ai.jpg") else "city_night.jpg", emit=(1, 1, 1), emit_strength=1.0, emit_tex=True)
make_mat("graffiti", tex="graffiti_ai.jpg", rough=0.9) if tex_path("graffiti_ai.jpg") else make_mat("graffiti", tex="graffiti.png", alpha_tex=True, rough=0.9)
make_mat("sign_babyseat", tex="sign_babyseat.png", alpha_tex=True, emit=(1, 1, 1), emit_strength=1.0, emit_tex=True)
make_mat("sign_4", tex="sign_4.png", alpha_tex=True, emit=(1, 1, 1), emit_strength=1.5, emit_tex=True)
make_mat("sign_5", tex="sign_5.png", alpha_tex=True, emit=(1, 1, 1), emit_strength=1.5, emit_tex=True)
make_mat("sign_6", tex="sign_6.png", alpha_tex=True, emit=(1, 1, 1), emit_strength=1.5, emit_tex=True)
make_mat("sign_wc", tex="sign_wc.png", alpha_tex=True, emit=(1, 1, 1), emit_strength=1.2, emit_tex=True)
make_mat("sign_hydrant", tex="sign_hydrant.png", rough=0.4)
make_mat("sign_kwangeum", tex="sign_kwangeum.png", alpha_tex=True, rough=0.6)
make_mat("glow_cone", tex="glow_cone.png", alpha_tex=True, emit=(1, 1, 1), emit_strength=1.5, emit_tex=True)


# ---------------------------------------------------------------- 지오메트리 헬퍼
ALL = []  # (obj, group_key) - 정적 오브젝트는 마지막에 머티리얼별로 병합


def _new_obj(name, me, props=None, merge=True):
    ob = bpy.data.objects.new(name, me)
    COL.objects.link(ob)
    if props:
        for k, v in props.items():
            ob[k] = v
    if merge:
        ALL.append(ob)
    return ob


def _uv_world(bm, mat_names, me):
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        tile = TILE.get(mat_names[f.material_index], 2.0) or 2.0
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            co = loop.vert.co
            if ax == 2:
                loop[uv].uv = (co.x / tile, co.y / tile)
            elif ax == 0:
                loop[uv].uv = ((-co.y if n.x > 0 else co.y) / tile, co.z / tile)
            else:
                loop[uv].uv = ((co.x if n.y < 0 else -co.x) / tile, co.z / tile)


def box(name, u0, u1, v0, v1, z0, z1, mat, side_mat=None, top_mat=None, bottom_mat=None,
        collide=True, floor=False, props=None, merge=True, faces="all"):
    """평면도 좌표 축정렬 박스. faces: 'all' 또는 생략할 면 집합 문자열 e.g. '-bottom'"""
    u0, u1 = min(u0, u1), max(u0, u1)
    v0, v1 = min(v0, v1), max(v0, v1)
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    x0, x1, y0, y1 = u0, u1, -v1, -v0
    vs = [bm.verts.new(p) for p in [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                                     (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]]
    mats = [mat, side_mat or mat, top_mat or mat, bottom_mat or mat]
    names = [m for m in mats]
    spec = {
        "bottom": ((0, 3, 2, 1), 3), "top": ((4, 5, 6, 7), 2),
        "s": ((0, 1, 5, 4), 1), "n": ((2, 3, 7, 6), 1), "w": ((3, 0, 4, 7), 1), "e": ((1, 2, 6, 5), 1),
    }
    skip = set(faces.replace("-", " ").split()) if faces != "all" else set()
    for key, (idx, mi) in spec.items():
        if key in skip:
            continue
        f = bm.faces.new([vs[i] for i in idx])
        f.material_index = mi
    bm.normal_update()
    _uv_world(bm, names, me)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(MATS[m])
    p = dict(props or {})
    if collide:
        p["collide"] = 1
    if floor:
        p["floor"] = 1
    return _new_obj(name, me, p, merge)


def wall(name, u0, v0, u1, v1, z0, z1, mat, thick=0.3, **kw):
    """두 점을 잇는 벽(축정렬). 두께는 선 중심 기준."""
    t = thick / 2
    if abs(u1 - u0) >= abs(v1 - v0):
        return box(name, u0, u1, v0 - t, v1 + t, z0, z1, mat, **kw)
    return box(name, u0 - t, u1 + t, v0, v1, z0, z1, mat, **kw)


def wall_with_openings(name, axis, fixed, a0, a1, z0, z1, mat, openings, thick=0.3, **kw):
    """axis='u'(동서 방향 벽, v=fixed) 또는 'v'(남북 방향 벽, u=fixed). openings=[(a0,a1,top)]"""
    segs = []
    cur = a0
    for (o0, o1, top) in sorted(openings):
        if o0 > cur:
            segs.append((cur, o0, z0, z1))
        if top < z1:
            segs.append((o0, o1, top, z1))
        cur = o1
    if cur < a1:
        segs.append((cur, a1, z0, z1))
    t = thick / 2
    for i, (s0, s1, zz0, zz1) in enumerate(segs):
        if axis == "u":
            box(f"{name}_{i}", s0, s1, fixed - t, fixed + t, zz0, zz1, mat, **kw)
        else:
            box(f"{name}_{i}", fixed - t, fixed + t, s0, s1, zz0, zz1, mat, **kw)


def plane(name, cu, cv, cz, w, h, facing, mat, offset=0.0, props=None, merge=False, uv=(0, 0, 1, 1)):
    """벽 부착 평면(UV 0..1). facing: 'N','S','E','W' 또는 'UP','DOWN' = 법선 방향"""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    hw, hh = w / 2, h / 2
    x, y, z = cu, -cv, cz
    if facing == "S":   # 법선 -Y(남쪽), 보는 사람 기준 왼쪽=동(+X)... 남쪽에서 북쪽을 볼 때 오른쪽=동
        y -= offset
        pts = [(x - hw, y, z - hh), (x + hw, y, z - hh), (x + hw, y, z + hh), (x - hw, y, z + hh)]
    elif facing == "N":
        y += offset
        pts = [(x + hw, y, z - hh), (x - hw, y, z - hh), (x - hw, y, z + hh), (x + hw, y, z + hh)]
    elif facing == "E":
        x += offset
        pts = [(x, y - hw, z - hh), (x, y + hw, z - hh), (x, y + hw, z + hh), (x, y - hw, z + hh)]
    elif facing == "W":
        x -= offset
        pts = [(x, y + hw, z - hh), (x, y - hw, z - hh), (x, y - hw, z + hh), (x, y + hw, z + hh)]
    elif facing == "UP":
        z += offset
        pts = [(x - hw, y - hh, z), (x + hw, y - hh, z), (x + hw, y + hh, z), (x - hw, y + hh, z)]
    else:  # DOWN
        z -= offset
        pts = [(x - hw, y + hh, z), (x + hw, y + hh, z), (x + hw, y - hh, z), (x - hw, y - hh, z)]
    vs = [bm.verts.new(p) for p in pts]
    f = bm.faces.new(vs)
    uvl = bm.loops.layers.uv.verify()
    a, b, c, d = uv
    for loop, co in zip(f.loops, [(a, b), (c, b), (c, d), (a, d)]):
        loop[uvl].uv = co
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MATS[mat])
    return _new_obj(name, me, props, merge)


def cylinder(name, cu, cv, z0, z1, r, mat, seg=16, collide=False, merge=True, props=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r, depth=z1 - z0)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(cu, -cv, (z0 + z1) / 2))
    _uv_world(bm, [mat], me)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MATS[mat])
    p = dict(props or {})
    if collide:
        p["collide"] = 1
    return _new_obj(name, me, p, merge)


def empty(name, cu, cv, cz, props, size=0.3, scale=None):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = size
    ob.location = (cu, -cv, cz)
    if scale:
        ob.scale = scale
    for k, v in props.items():
        ob[k] = v
    COL.objects.link(ob)
    return ob


def poster_uv(k):
    """posters 아틀라스(4열 x 2행)에서 k번째 포스터 UV"""
    k %= 8
    c, r = k % 4, k // 4
    return (c / 4, 1 - (r + 1) / 2, (c + 1) / 4, 1 - r / 2)


def poster_box(name, cu, cv, z, facing, k, w=1.3, h=1.86):
    """벽부착 포스터 라이트박스 (검은 프레임 + 발광 포스터)"""
    d = 0.12
    if facing in ("E", "W"):
        sgn = 1 if facing == "E" else -1
        box(name + "_frame", cu, cu + sgn * d, cv - w / 2 - 0.08, cv + w / 2 + 0.08, z - h / 2 - 0.08, z + h / 2 + 0.08, "black_plastic", collide=False)
        plane(name, cu + sgn * d, cv, z, w, h, facing, "posters", offset=0.005, merge=True, uv=poster_uv(k))
    else:
        sgn = -1 if facing == "N" else 1
        box(name + "_frame", cu - w / 2 - 0.08, cu + w / 2 + 0.08, cv, cv + sgn * d, z - h / 2 - 0.08, z + h / 2 + 0.08, "black_plastic", collide=False)
        plane(name, cu, cv + sgn * d, z, w, h, facing, "posters", offset=0.005, merge=True, uv=poster_uv(k))


def light(name, cu, cv, cz, kind="point", color=(1, 0.9, 0.8), intensity=8.0, distance=12.0, **extra):
    return empty(name, cu, cv, cz, dict(light=kind, color=list(color), intensity=intensity, distance=distance, **extra), 0.2)


# ================================================================= 레이아웃
# 주요 좌표(m)
AUD_U0, AUD_U1, AUD_V0, AUD_V1 = U(160), U(390), V(80), V(280)   # 4관 내부 4.875..22.125, 3..18
AUD_H = 8.6
LOBBY_H = 5.0
COR_H = 3.2
W_GLASS_U = U(100)
SOUTH_V = V(893)
TH = 0.3

# ---------------------------------------------------------------- 바닥 & 천장
# 로비 전체 바닥 (진회색 타일)
box("F_lobby_main", 0.0, U(390) + 0.15, V(340) - 0.15, SOUTH_V, -0.2, 0.0, "floor_dark", floor=True, collide=False)
box("F_lobby_east", U(390) + 0.15, U(610), V(650), V(683), -0.2, 0.0, "floor_dark", floor=True, collide=False)
# 4관 입구 앞 우드 타일 존 + 6관 알코브
box("F_wood", U(390) + 0.15, U(555), V(265), V(395), -0.2, 0.0, "floor_wood", floor=True, collide=False)
box("F_wood2", U(390) + 0.15, U(415), V(395), V(650), -0.2, 0.0, "floor_dark", floor=True, collide=False)
# 서쪽 복도(포스터 복도)
box("F_westcor", 0.0, AUD_U0 - TH, V(45), V(340) - 0.15, -0.2, 0.0, "floor_wood", floor=True, collide=False)
# 4관 동쪽/북쪽 입장 복도 (카펫)
box("F_entry_e", AUD_U1 + TH, U(435), V(45), V(265), -0.2, 0.0, "carpet_dark", floor=True, collide=False)
box("F_entry_n", U(330), AUD_U1 + TH, V(45), AUD_V0 - TH, -0.2, 0.0, "carpet_dark", floor=True, collide=False)
# 5관 복도
box("F_5cor", U(465) + 0.15, U(555), V(45), V(265), -0.2, 0.0, "floor_wood", floor=True, collide=False)
# 화장실
box("F_wc", U(400), U(610), V(683) + 0.15, V(840), -0.2, 0.0, "wall_white", floor=True, collide=False)

# 천장 (4관 박스 제외)
box("C_lobby_s", 0.0, U(610), V(340), SOUTH_V, LOBBY_H, LOBBY_H + 0.2, "ceiling_gray", collide=False)
box("C_lobby_ne", AUD_U1 + TH, U(610), V(265), V(340), LOBBY_H, LOBBY_H + 0.2, "ceiling_gray", collide=False)
box("C_entry", AUD_U1 + TH, U(555), V(45), V(265), COR_H, COR_H + 0.2, "ceiling_dark", collide=False)
box("C_entry_n", U(330), AUD_U1 + TH, V(45), AUD_V0 - TH, COR_H, COR_H + 0.2, "ceiling_dark", collide=False)
box("C_westcor", 0.0, AUD_U0 - TH, V(45), V(340), COR_H + 0.6, COR_H + 0.8, "ceiling_dark", collide=False)
box("C_strip", AUD_U0 - TH, AUD_U1 + TH, AUD_V1 + TH, V(340), LOBBY_H, LOBBY_H + 0.2, "ceiling_gray", collide=False)

# ---------------------------------------------------------------- 외벽
# 서쪽 외벽(북쪽 구간, 포스터 복도) - 평면도의 요철을 벽감으로 표현
wall("W_west_n", -0.15, V(45), -0.15, V(510), 0, LOBBY_H, "wall_stone")
for i, (a, b) in enumerate([(80, 110), (155, 185), (225, 260)]):
    # 벽감 사이 기둥(필라스터)
    box(f"W_pilaster_{i}", 0.0, 0.45, V(a) - 0.6, V(a), 0, COR_H + 0.6, "wall_charcoal")
# 서쪽 유리창 (바 테이블 구간)
box("W_glass", W_GLASS_U - 0.03, W_GLASS_U + 0.03, V(510), SOUTH_V, 0.0, LOBBY_H, "glass", collide=True)
for i in range(16):
    vv = V(510) + i * (SOUTH_V - V(510)) / 15
    box(f"W_mullion_{i}", W_GLASS_U - 0.06, W_GLASS_U + 0.06, vv - 0.04, vv + 0.04, 0, LOBBY_H, "steel_dark", collide=False)
box("W_glass_sill", W_GLASS_U - 0.1, W_GLASS_U + 0.1, V(510), SOUTH_V, 0.0, 0.25, "steel_dark")
box("W_glass_top", W_GLASS_U - 0.1, W_GLASS_U + 0.1, V(510), SOUTH_V, LOBBY_H - 0.3, LOBBY_H, "steel_dark", collide=False)
wall("W_west_mid", -0.15, V(340), -0.15, V(510), 0, LOBBY_H, "wall_stone")
# 창밖 야경
plane("BG_city", -18.0, (V(510) + SOUTH_V) / 2, 6.0, 80, 40, "E", "city_night", merge=False)
# 북쪽 외벽
wall("W_north", -0.3, -0.15 + V(45) - 0.15, U(560), -0.15 + V(45) - 0.15, 0, LOBBY_H, "wall_charcoal")
# 남쪽 외벽 (에스컬레이터 개구부 U(250)~U(285))
wall_with_openings("W_south", "u", SOUTH_V + 0.15, -0.3, U(290), 0, LOBBY_H, "wall_stone", [(U(252), U(283), 3.2)])
# 동쪽 외벽
wall("W_east_5cor", U(555) + 0.15, V(45), U(555) + 0.15, V(265), 0, COR_H, "wall_charcoal")

# ---------------------------------------------------------------- 4관 외곽 박스 & 입장 복도
# 4관 벽(외부에서 보이는 면은 석재/어두운 벽)
wall("A_wall_w", AUD_U0 - TH / 2, AUD_V0 - TH, AUD_U0 - TH / 2, AUD_V1 + TH, 0, AUD_H, "wall_charcoal")
wall("A_wall_e", AUD_U1 + TH / 2, AUD_V0 - TH, AUD_U1 + TH / 2, AUD_V1 + TH, 0, AUD_H, "wall_dark")
# 북쪽 벽: 스크린 쪽 끝에 입장구 (U(355)~U(380))
ENT_U0, ENT_U1 = U(352), U(378)
wall_with_openings("A_wall_n", "u", AUD_V0 - TH / 2, AUD_U0 - TH, AUD_U1 + TH, 0, AUD_H, "wall_theater",
                   [(ENT_U0, ENT_U1, 2.6)])
wall("A_wall_s", AUD_U0 - TH, AUD_V1 + TH / 2, AUD_U1 + TH, AUD_V1 + TH / 2, 0, AUD_H, "wall_theater")
# 4관 남쪽 띠 블록 (로비 북벽: 석재 + LOTTE CINEMA 사인)
box("B_strip", AUD_U0 - TH, AUD_U1 + TH, AUD_V1 + TH, V(340) - 0.15, 0, LOBBY_H, "wall_stone")
plane("SIGN_lotte", (AUD_U0 + AUD_U1) / 2 - 2.5, V(340) - 0.15, 3.3, 7.2, 1.8, "S", "sign_lotte", offset=0.02)
# 4관 입장 복도: 동쪽 복도 벽 (서쪽은 4관 동벽), 동쪽은 U(435) 고체 블록
wall("E_cor_east", U(435) + 0.15, V(45), U(435) + 0.15, V(265), 0, COR_H, "wall_charcoal")
box("E_block", U(435) + 0.3, U(465), V(45), V(265), 0, LOBBY_H, "wall_charcoal")  # 4관/5관 복도 사이 덩어리
# 북쪽 복도 서쪽 끝 막음
wall("E_cor_nend", U(330), V(45), U(330), AUD_V0 - TH, 0, COR_H, "wall_charcoal")
# 4관 입구 파사드 (v=V(270)) - 문 개구부 U(398)~U(428)
DOOR_U0, DOOR_U1 = AUD_U1 + TH + 0.25, U(432) - 0.1
FAC_V = V(268)
wall_with_openings("E_facade", "u", FAC_V, AUD_U1 + TH, U(435) + 0.3, 0, LOBBY_H, "wall_stone",
                   [(DOOR_U0, DOOR_U1, 2.4)], thick=0.4)
# 열린 철문 두 짝(장식)
box("E_door_l", DOOR_U0, DOOR_U0 + 0.06, FAC_V + 0.2, FAC_V + 1.2, 0, 2.35, "metal", collide=False)
box("E_door_frame_t", DOOR_U0, DOOR_U1, FAC_V - 0.22, FAC_V + 0.22, 2.35, 2.4, "steel_dark", collide=False)
# 광음시네마 세로 글씨 + 루버 (문 오른쪽 기둥면)
box("E_louver_bg", DOOR_U1 + 0.1, U(435) + 0.2, FAC_V + 0.2, FAC_V + 0.24, 0.3, 2.4, "wall_white", collide=False)
for i in range(18):
    zz = 0.4 + i * 0.11
    box(f"E_louver_{i}", DOOR_U1 + 0.15, DOOR_U1 + 0.6, FAC_V + 0.24, FAC_V + 0.29, zz, zz + 0.03, "metal", collide=False)
plane("SIGN_kwangeum", DOOR_U1 + 0.95, FAC_V + 0.2, 1.65, 0.45, 2.25, "S", "sign_kwangeum", offset=0.05, merge=False)
# 상영관 전광판 (문 위, 천장에 매달린 가로형 디스플레이) - 클라이언트가 문구를 그림
SIGN4_W, SIGN4_H = 4.4, 1.25
box("E_sign4_frame", AUD_U1 + 0.1, AUD_U1 + 0.2 + SIGN4_W + 0.2, FAC_V + 0.5, FAC_V + 0.62, 3.35, 3.35 + SIGN4_H + 0.16, "black_plastic", collide=False)
plane("SIGN_4", AUD_U1 + 0.2 + SIGN4_W / 2 + 0.1, FAC_V + 0.62, 3.43 + SIGN4_H / 2, SIGN4_W, SIGN4_H, "S", "led_black", offset=0.01,
      props={"display": "sign4", "w": SIGN4_W, "h": SIGN4_H})
box("E_sign4_rod1", AUD_U1 + 0.6, AUD_U1 + 0.65, FAC_V + 0.54, FAC_V + 0.58, 3.35 + SIGN4_H + 0.16, LOBBY_H, "steel_dark", collide=False)
box("E_sign4_rod2", AUD_U1 + SIGN4_W - 0.1, AUD_U1 + SIGN4_W - 0.05, FAC_V + 0.54, FAC_V + 0.58, 3.35 + SIGN4_H + 0.16, LOBBY_H, "steel_dark", collide=False)
# 문 옆 작은 카운터 (따뜻한 하부 조명)
box("E_counter", AUD_U1 - 1.6, AUD_U1 + TH, FAC_V + 0.3, FAC_V + 2.4, 0, 1.05, "wall_charcoal", top_mat="black_plastic")
box("E_counter_glow", AUD_U1 - 1.62, AUD_U1 - 1.58, FAC_V + 0.3, FAC_V + 2.4, 0.05, 0.95, "emit_warm", collide=False)
# 복도 내부: 벽등과 출구 사인
for i, vv in enumerate([V(240), V(190), V(140), V(90)]):
    plane(f"L_cor_glow_{i}", U(435) - 0.01, vv, 1.9, 0.9, 1.6, "W", "glow_cone", offset=0.0)
    light(f"LIGHT_cor_{i}", U(413), vv, 2.8, intensity=3.0, distance=6.0, color=(1, 0.8, 0.6))
plane("SIGN_exit_ent", (ENT_U0 + ENT_U1) / 2, AUD_V0 - TH, 2.85, 0.6, 0.3, "N", "sign_exit", offset=0.01, merge=True)
plane("SIGN_4_entry", (DOOR_U0 + DOOR_U1) / 2, FAC_V - 0.2, 2.75, 1.0, 0.5, "N", "sign_4", offset=0.01, merge=True)

# ---------------------------------------------------------------- 4관 내부 (광음시네마)
# 바닥: 앞쪽 평지(카펫)
box("A_floor_front", AUD_U0, AUD_U1, AUD_V0, AUD_V1, -0.2, 0.0, "carpet", floor=True, collide=False)
box("A_ceiling", AUD_U0 - TH, AUD_U1 + TH, AUD_V0 - TH, AUD_V1 + TH, AUD_H, AUD_H + 0.2, "ceiling_dark", collide=False)
# 내부 벽 마감 (석재 흡음벽) - 벽 안쪽에 얇은 판
box("A_in_s", AUD_U0, AUD_U1 - 0.6, AUD_V1 - 0.08, AUD_V1, 0, AUD_H, "wall_theater", collide=False, faces="-s")
box("A_in_w", AUD_U0, AUD_U0 + 0.08, AUD_V0, AUD_V1, 0, AUD_H, "wall_theater", collide=False, faces="-w")
# 북벽 판은 입장구 개구부를 피해서 구성
box("A_in_n1", AUD_U0, ENT_U0, AUD_V0, AUD_V0 + 0.08, 0, AUD_H, "wall_theater", collide=False, faces="-n")
box("A_in_n2", ENT_U0, ENT_U1, AUD_V0, AUD_V0 + 0.08, 2.6, AUD_H, "wall_theater", collide=False, faces="-n")
# 스크린 벽 (검정) + 스크린
box("A_screenwall", AUD_U1 - 0.6, AUD_U1, AUD_V0, AUD_V1, 0, AUD_H, "wall_dark", faces="-e")
SCR_W, SCR_H = 12.4, 5.3
SCR_CV = (AUD_V0 + AUD_V1) / 2 + 0.6
SCR_Z0 = 1.5
box("A_screen_mask", AUD_U1 - 0.62, AUD_U1 - 0.6, SCR_CV - SCR_W / 2 - 0.35, SCR_CV + SCR_W / 2 + 0.35, SCR_Z0 - 0.35, SCR_Z0 + SCR_H + 0.35, "black_plastic", collide=False)
plane("SCREEN_4", AUD_U1 - 0.62, SCR_CV, SCR_Z0 + SCR_H / 2, SCR_W, SCR_H, "W", "screen", offset=0.01,
      props={"display": "screen4", "w": SCR_W, "h": SCR_H})
# 스크린 앞 무대 단
box("A_stage", AUD_U1 - 1.6, AUD_U1 - 0.6, AUD_V0 + 0.5, AUD_V1 - 0.5, 0, 0.35, "black_plastic", floor=True)
# 광음 서브우퍼 큐브 + 보라색 LED 바닥 (사진 참고)
for i in range(8):
    cv = AUD_V0 + 1.6 + i * (AUD_V1 - AUD_V0 - 3.2) / 7
    cu = AUD_U1 - 2.4 - (0.6 if i in (0, 7) else 0)
    box(f"A_sub_{i}", cu - 0.42, cu + 0.42, cv - 0.42, cv + 0.42, 0.1, 1.0, "black_plastic")
    box(f"A_sub_base_{i}", cu - 0.5, cu + 0.5, cv - 0.5, cv + 0.5, 0.0, 0.1, "emit_purple", collide=False)
    box(f"A_sub_top_{i}", cu - 0.1, cu + 0.1, cv - 0.06, cv + 0.06, 1.0, 1.01, "metal", collide=False)
    light(f"LIGHT_sub_{i}", cu, cv, 0.15, color=(0.55, 0.25, 1.0), intensity=1.6, distance=2.5, theater=1)
# 측벽 스피커 + 업라이트 글로우
for side, vv, fac in (("n", AUD_V0 + 0.08, "S"), ("s", AUD_V1 - 0.08, "N")):
    for i in range(5):
        cu = AUD_U1 - 3.5 - i * 3.0
        sgn = 1 if side == "n" else -1
        box(f"A_spk_{side}{i}", cu - 0.3, cu + 0.3, vv, vv + sgn * 0.35, 4.6, 5.4, "black_plastic", collide=False)
        plane(f"A_glow_{side}{i}", cu + 1.5, vv, 3.4, 1.4, 4.2, fac, "glow_cone", offset=0.02)
        box(f"A_uplight_{side}{i}", cu + 1.4, cu + 1.6, vv, vv + sgn * 0.12, 1.25, 1.35, "emit_warm", collide=False)
# 남측벽 그래피티 벽화 (스크린 가까운 쪽)
plane("A_graffiti", AUD_U1 - 5.6, AUD_V1 - 0.08, 4.0, 8.4, 4.2, "N", "graffiti", offset=0.03, merge=False)
# 천장 다운라이트 (작은 발광점)
for i in range(6):
    for j in range(5):
        cylinder(f"A_dl_{i}_{j}", AUD_U0 + 1.5 + i * 2.9, AUD_V0 + 1.5 + j * 3.0, AUD_H - 0.02, AUD_H, 0.07, "emit_white", seg=8)
# 영사실 창 (뒷벽 상단)
box("A_proj_win", AUD_U0, AUD_U0 + 0.1, (AUD_V0 + AUD_V1) / 2 - 0.8, (AUD_V0 + AUD_V1) / 2 + 0.8, 6.3, 7.1, "emit_blue", collide=False)
empty("PROJECTOR", AUD_U0 + 0.15, (AUD_V0 + AUD_V1) / 2, 6.7, {"projector": 1})
# 출구 사인 (스크린 옆 입장구 내부 쪽)
plane("SIGN_exit_in", (ENT_U0 + ENT_U1) / 2, AUD_V0 + 0.1, 2.85, 0.6, 0.3, "S", "sign_exit", offset=0.01, merge=True)
# 극장 조명
light("LIGHT_th_front", AUD_U1 - 4, (AUD_V0 + AUD_V1) / 2, 6.5, intensity=6.0, distance=14.0, color=(1, 0.85, 0.7), theater=1)
light("LIGHT_th_mid", (AUD_U0 + AUD_U1) / 2, (AUD_V0 + AUD_V1) / 2, 7.5, intensity=6.0, distance=14.0, color=(1, 0.85, 0.7), theater=1)
light("LIGHT_th_back", AUD_U0 + 3, (AUD_V0 + AUD_V1) / 2, 7.5, intensity=5.0, distance=12.0, color=(1, 0.85, 0.7), theater=1)
empty("ZONE_THEATER4", (AUD_U0 + AUD_U1) / 2, (AUD_V0 + AUD_V1) / 2, AUD_H / 2,
      {"zone": "theater4", "su": AUD_U1 - AUD_U0, "sv": AUD_V1 - AUD_V0, "sz": AUD_H})

# --- 객석 (스타디움식) ---
AISLE_V1 = AUD_V0 + 1.5     # 북쪽 계단 통로 v: AUD_V0 ~ AISLE_V1
SEAT_PITCH = 0.62
ROW_PITCH = 1.05
ROWS = "BCDEFGHIJK"
ROW_A_U = AUD_U1 - 5.2
ROW_B_U = ROW_A_U - 1.35
RISE0, RISE = 0.3, 0.4


def row_u(k):  # k=0 → B열
    return ROW_B_U - k * ROW_PITCH


def row_z(k):
    return RISE0 + k * RISE


# 단(tier) 블록: 각 열 플랫폼
for k in range(len(ROWS)):
    uc = row_u(k)
    u_front = uc + ROW_PITCH / 2 + (0.15 if k == 0 else 0)
    u_back = uc - ROW_PITCH / 2 if k < len(ROWS) - 1 else AUD_U0
    z = row_z(k)
    box(f"T_tier_{k}", u_back, u_front, AISLE_V1, AUD_V1, 0, z, "carpet", side_mat="carpet_dark", floor=True)
    # 단 앞면 스텝 라이트
    box(f"T_tier_led_{k}", u_front, u_front + 0.01, AISLE_V1, AUD_V1, z - 0.05, z - 0.03, "emit_step", collide=False)
    # 계단(통로): 열당 2단
    for s in range(2):
        z_s = row_z(k) - RISE / 2 * (1 - s) if k > 0 else (RISE0 / 2 * (s + 1))
        if k == 0:
            z_s = RISE0 / 2 * (s + 1)
        s_u1 = u_front - s * (ROW_PITCH / 2)
        s_u0 = s_u1 - ROW_PITCH / 2
        if k == len(ROWS) - 1 and s == 1:
            s_u0 = AUD_U0
        box(f"T_stair_{k}_{s}", s_u0, s_u1, AUD_V0, AISLE_V1, 0, z_s, "carpet_dark", floor=True)
        box(f"T_stair_led_{k}_{s}", s_u1, s_u1 + 0.01, AUD_V0 + 0.1, AISLE_V1 - 0.1, z_s - 0.03, z_s - 0.01, "emit_step", collide=False)
# 통로 난간 (계단과 객석 사이 - 열 출입 위해 낮은 끝막이만)
for k in range(len(ROWS)):
    uc = row_u(k)
    box(f"T_endcap_{k}", uc - 0.45, uc + 0.15, AISLE_V1 + 0.02, AISLE_V1 + 0.1, row_z(k), row_z(k) + 0.75, "blue_seat_shell", collide=False)

# 좌석 메시 (공유 메시 → glTF에서 1번만 저장, 클라이언트에서 인스턴싱)
def build_seat_mesh(name, recliner=False):
    bm = bmesh.new()
    parts = []

    def cube(x0, x1, y0, y1, z0, z1, mi, tilt=0.0, pivot=None):
        r = bmesh.ops.create_cube(bm, size=1.0)
        vs = r["verts"]
        bmesh.ops.scale(bm, verts=vs, vec=(x1 - x0, y1 - y0, z1 - z0))
        bmesh.ops.translate(bm, verts=vs, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
        if tilt:
            bmesh.ops.rotate(bm, verts=vs, cent=pivot, matrix=Matrix.Rotation(tilt, 3, "Y"))
        for f in {f for v in vs for f in v.link_faces}:
            f.material_index = mi

    # 로컬: +X = 정면(스크린 쪽), Y = 좌우, Z = 위.  원점 = 좌석 바닥 중심
    if not recliner:
        w = 0.54
        cube(-0.25, 0.25, -w / 2, w / 2, 0.36, 0.5, 0)                                  # 방석
        cube(-0.34, -0.22, -w / 2, w / 2, 0.45, 1.05, 0, tilt=-0.17, pivot=(-0.28, 0, 0.45))  # 등받이
        cube(-0.4, -0.3, -w / 2 + 0.03, w / 2 - 0.03, 0.85, 1.1, 1, tilt=-0.17, pivot=(-0.28, 0, 0.45))  # 헤드레스트(LOTTE)
        cube(-0.3, 0.2, -w / 2 + 0.02, w / 2 - 0.02, 0.0, 0.36, 2)                       # 하부 쉘
        for sy in (-1, 1):
            cube(-0.3, 0.28, sy * (w / 2 + 0.04) - 0.04, sy * (w / 2 + 0.04) + 0.04, 0.0, 0.66, 2)  # 팔걸이
            cube(0.16, 0.24, sy * (w / 2 + 0.04) - 0.045, sy * (w / 2 + 0.04) + 0.045, 0.62, 0.67, 3)  # 컵홀더
    else:
        w = 0.78
        cube(-0.3, 0.3, -w / 2, w / 2, 0.3, 0.52, 0)
        cube(-0.45, -0.25, -w / 2, w / 2, 0.45, 1.15, 0, tilt=-0.2, pivot=(-0.35, 0, 0.45))
        cube(-0.5, -0.38, -w / 2 + 0.05, w / 2 - 0.05, 0.95, 1.2, 1, tilt=-0.2, pivot=(-0.35, 0, 0.45))
        cube(0.3, 0.75, -w / 2 + 0.04, w / 2 - 0.04, 0.12, 0.38, 0)                      # 풋레스트
        cube(-0.35, 0.3, -w / 2, w / 2, 0.0, 0.3, 2)
        for sy in (-1, 1):
            cube(-0.4, 0.35, sy * (w / 2 + 0.07) - 0.07, sy * (w / 2 + 0.07) + 0.07, 0.0, 0.68, 2)
    me = bpy.data.meshes.new(name)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            c = loop.vert.co
            loop[uv].uv = ((c.y + 0.5), (c.z if ax != 2 else c.x + 0.5)) if f.material_index == 1 else ((c.y if ax != 1 else c.x) / 0.6, c.z / 0.6)
    bm.to_mesh(me)
    bm.free()
    for m in ("seat_fabric", "seat_logo", "blue_seat_shell", "black_plastic"):
        me.materials.append(MATS[m])
    return me


SEAT_ME = build_seat_mesh("seat_std")
RECL_ME = build_seat_mesh("seat_recliner", recliner=True)
SEAT_V0 = AISLE_V1 + 0.75
seat_count = 0


def place_seat(me, sid, row, num, u, v, z):
    global seat_count
    ob = bpy.data.objects.new(f"SEATMESH_{sid}", me)
    ob.location = (u, -v, z)
    COL.objects.link(ob)
    # 착석 지점 (엉덩이 위치) : 좌석보다 살짝 앞, 방석 위
    empty(f"SEAT_{sid}", u + 0.02, v, z + 0.48, {"seat": sid, "row": row, "num": num, "yaw": 0.0, "facing": "+x"}, 0.15)
    seat_count += 1


# A열: 리클라이너 10석 (2석씩 묶음)
for i in range(10):
    pair, side = divmod(i, 2)
    v = SEAT_V0 + 0.4 + pair * 2.25 + side * 0.86
    place_seat(RECL_ME, f"A{i + 1}", "A", i + 1, ROW_A_U, v, 0.0)
# B~K열: 18석
for k, r in enumerate(ROWS):
    for i in range(18):
        v = SEAT_V0 + i * SEAT_PITCH
        place_seat(SEAT_ME, f"{r}{i + 1}", r, i + 1, row_u(k) - 0.05, v, row_z(k))
print("seats:", seat_count)

# ---------------------------------------------------------------- 서쪽 포스터 복도 & 키오스크
for i, (a, b) in enumerate([(80, 110), (155, 185), (225, 260), (300, 338)]):
    poster_box(f"P_poster_{i}", 0.0, (V(a) + V(b)) / 2, 1.75, "E", i)
# 복도 북쪽 끝: 4관 후면 비상문(닫힘)
box("P_exitdoor", 0.6, 3.6, V(45) - 0.1, V(45) + 0.05, 0, 2.3, "steel_dark", collide=False)
plane("P_exit_sign", 2.1, V(45) + 0.06, 2.6, 0.6, 0.3, "S", "sign_exit", offset=0.01, merge=True)
light("LIGHT_westcor", 2.0, V(190), 3.4, intensity=4.0, distance=10.0, color=(1, 0.9, 0.8))
# 키오스크 열 (포토티켓 / 티켓 발권 / 바로팝콘 / 배터리 대여)
KIOSK_V0, KIOSK_V1 = V(343), V(437)
box("K_backwall", 0.0, 0.3, KIOSK_V0, KIOSK_V1, 0, 3.2, "wall_charcoal")
for i in range(4):
    v0 = KIOSK_V0 + 0.3 + i * (KIOSK_V1 - KIOSK_V0 - 0.6) / 4
    v1 = v0 + (KIOSK_V1 - KIOSK_V0 - 0.6) / 4 - 0.25
    body = "kiosk_red" if i in (1, 2) else "kiosk_body"
    box(f"K_body_{i}", 0.3, 1.0, v0, v1, 0, 1.95, body)
    plane(f"K_screen_{i}", 1.0, (v0 + v1) / 2, 1.35, v1 - v0 - 0.2, 0.75, "E", "kiosk_screens", offset=0.005, merge=True,
          uv=(i / 4, 0, (i + 1) / 4, 1))
    box(f"K_slot_{i}", 1.0, 1.05, v0 + 0.2, v1 - 0.2, 0.75, 0.82, "black_plastic", collide=False)
# 배터리 대여 사인
plane("K_battery_glow", 0.31, KIOSK_V1 - 0.6, 2.4, 1.0, 0.25, "E", "emit_green", offset=0.0, merge=True)
# 주차요금 안내 스탠드
box("K_parking", 1.2, 1.3, KIOSK_V1 + 0.6, KIOSK_V1 + 1.2, 0, 1.6, "black_plastic")

# ---------------------------------------------------------------- 5관 복도 & 베이비시트 & 6관
# 베이비시트 선반 (평면도 오른쪽 위 박스)
BS_U0, BS_U1, BS_V0, BS_V1 = U(468), U(470) + 0.6, V(205), V(265)
box("BS_shelf", BS_U0, BS_U1, BS_V0, BS_V1, 0, 2.1, "wall_white")
for j in range(5):
    zz = 0.15 + j * 0.4
    box(f"BS_board_{j}", BS_U0, BS_U1, BS_V0, BS_V1, zz, zz + 0.03, "steel_dark", collide=False)
    for s in range(4):
        vv = BS_V0 + 0.35 + s * (BS_V1 - BS_V0 - 0.7) / 3
        box(f"BS_seat_{j}_{s}", BS_U1 - 0.5, BS_U1 - 0.05, vv - 0.18, vv + 0.18, zz + 0.03, zz + 0.3, "baby_seat", collide=False)
plane("BS_sign", BS_U0 + 0.3, BS_V0 - 0.01, 2.4, 2.0, 0.25, "N", "sign_babyseat", offset=0.0, merge=True)
# 5관 문 (복도 북쪽 끝)
box("D_5_door", U(480), U(540), V(45) - 0.02, V(45) + 0.06, 0, 2.4, "steel_dark", collide=False)
plane("SIGN_5", U(510), V(45) + 0.07, 2.8, 1.4, 0.7, "S", "sign_5", offset=0.0, merge=True)
plane("SIGN_5_hall", U(510), V(265) - 0.1, 3.4, 1.4, 0.7, "S", "sign_5", offset=0.0, merge=True)
light("LIGHT_5cor", U(510), V(150), 2.9, intensity=3.0, distance=9.0)
# 6관 알코브 동쪽 벽 + 6관 문 2개
wall_with_openings("W_6", "v", U(555) + 0.15, V(265), V(395), 0, LOBBY_H, "wall_stone",
                   [(V(268) + 0.2, V(295), 2.4), (V(342), V(366), 2.4)])
for i, (a, b) in enumerate([(V(268) + 0.2, V(295)), (V(342), V(366))]):
    box(f"D_6_door_{i}", U(555) + 0.25, U(555) + 0.32, a, b, 0, 2.4, "steel_dark")
plane("SIGN_6", U(555), (V(295) + V(342)) / 2, 3.2, 1.4, 0.7, "W", "sign_6", offset=0.0, merge=True)
# 알코브 북쪽 벽 (E_block 남쪽면까지) + 5관 복도 동벽은 위에서
box("W_alcove_n", U(435) + 0.3, U(465) + 0.15, V(262), V(268), 0, LOBBY_H, "wall_stone")
# 기둥
box("COL_p1", U(441), U(457), V(328), V(344), 0, LOBBY_H, "wall_stone")
box("COL_p2", U(291), U(307), V(522), V(538), 0, LOBBY_H, "wall_stone")
# 알코브 남쪽 = Sweet 블록 북벽
light("LIGHT_alcove", U(480), V(330), 4.6, intensity=6.0, distance=14.0)

# ---------------------------------------------------------------- Sweet# 매점
SW_U0, SW_U1, SW_V0, SW_V1 = U(385), U(570), V(395), V(650)
CNT_U1 = SW_U0 + 0.75
KITCH_U = SW_U0 + 2.6
# 블록 외벽
wall("SW_n", SW_U0, SW_V0, SW_U1, SW_V0, 0, LOBBY_H, "wall_stone")
wall("SW_s", SW_U0, SW_V1, SW_U1, SW_V1, 0, LOBBY_H, "wall_stone")
wall("SW_e", SW_U1, SW_V0, SW_U1, SW_V1, 0, LOBBY_H, "wall_stone")
# 카운터 (두 구간)
for i, (a, b) in enumerate([(SW_V0 + 0.3, V(497) - 0.2), (V(497) + 0.2, SW_V1 - 0.3)]):
    box(f"SW_counter_{i}", SW_U0, CNT_U1, a, b, 0, 1.08, "wall_charcoal", top_mat="black_plastic")
    box(f"SW_counter_glow_{i}", SW_U0 - 0.01, SW_U0, a, b, 0.08, 0.98, "emit_warm", collide=False)
    box(f"SW_counter_top_{i}", SW_U0 - 0.05, CNT_U1, a, b, 1.08, 1.12, "steel_dark", collide=False, floor=False)
# 카운터 사이 막음(직원 통로 문)
box("SW_gap", SW_U0 + 0.3, CNT_U1, V(497) - 0.2, V(497) + 0.2, 0, 1.0, "invisible", props={"invisible": 1})
# 주방 뒷벽 (벽돌) + 팝콘 기계
box("SW_kitchen_wall", KITCH_U, KITCH_U + 0.3, SW_V0, SW_V1, 0, LOBBY_H, "brick")
for i in range(3):
    vv = SW_V0 + 2.0 + i * 3.0
    box(f"SW_popcorn_{i}", KITCH_U - 0.8, KITCH_U, vv - 0.6, vv + 0.6, 0.9, 2.1, "metal", collide=False)
    box(f"SW_popcorn_glow_{i}", KITCH_U - 0.81, KITCH_U - 0.8, vv - 0.5, vv + 0.5, 1.2, 1.9, "emit_warm", collide=False)
    box(f"SW_bench_{i}", KITCH_U - 0.9, KITCH_U, vv - 1.4, vv + 1.4, 0, 0.9, "steel_dark", collide=False)
for i in range(2):
    vv = V(560) + i * 2.2
    box(f"SW_drink_{i}", KITCH_U - 0.7, KITCH_U, vv - 0.5, vv + 0.5, 0.9, 1.8, "black_plastic", collide=False)
# 소핏(내려온 천장) + 메뉴 보드 + Sweet# 간판
box("SW_soffit", SW_U0 - 0.2, KITCH_U, SW_V0, SW_V1, 3.05, LOBBY_H, "wall_charcoal", collide=False)
plane("SW_menu", SW_U0 - 0.2, (SW_V0 + V(540)) / 2, 2.72, 7.6, 1.19, "W", "menu_boards", offset=0.02, merge=False)
box("SW_menu_frame", SW_U0 - 0.22, SW_U0 - 0.12, SW_V0 + 0.3, V(540) + 0.2, 2.05, 3.05, "black_plastic", collide=False)
plane("SW_sign", SW_U0 - 0.2, (SW_V0 + V(540)) / 2 + 0.5, 4.05, 4.4, 1.1, "W", "sign_sweet", offset=0.03, merge=False)
# 픽업 사인
plane("SW_pickup", SW_U0 - 0.2, V(600), 2.55, 1.4, 0.4, "W", "emit_blue", offset=0.03, merge=True)
# 디지털 사이니지 기둥
box("SW_signage", SW_U0 - 2.2, SW_U0 - 1.6, V(410) - 0.35, V(410) + 0.35, 0, 2.2, "black_plastic")
plane("SW_signage_scr", SW_U0 - 2.2, V(410), 1.3, 0.62, 0.89, "W", "posters", offset=0.005, merge=True, uv=poster_uv(4))
plane("SW_signage_scr2", SW_U0 - 1.6, V(410), 1.3, 0.62, 0.89, "E", "posters", offset=0.005, merge=True, uv=poster_uv(5))
light("LIGHT_sweet", SW_U0 - 1.5, (SW_V0 + SW_V1) / 2, 4.4, intensity=8.0, distance=14.0, color=(1, 0.88, 0.75))
light("LIGHT_sweet_in", SW_U0 + 1.6, (SW_V0 + SW_V1) / 2, 2.9, intensity=4.0, distance=8.0, color=(1, 0.75, 0.5))

# ---------------------------------------------------------------- 화장실 & 소화전
WC_U0, WC_U1, WC_V0, WC_V1 = U(400), U(610), V(683), V(840)
wall_with_openings("WC_n", "u", WC_V0, WC_U0, WC_U1, 0, LOBBY_H, "wall_stone", [(U(478), U(503), 2.3)])
wall("WC_s", WC_U0, WC_V1, WC_U1, WC_V1, 0, LOBBY_H, "wall_white")
wall("WC_w", WC_U0, WC_V0, WC_U0, WC_V1, 0, LOBBY_H, "wall_white")
wall("WC_e", WC_U1, V(650), WC_U1, WC_V1, 0, LOBBY_H, "wall_white")
box("WC_ceiling", WC_U0, WC_U1, WC_V0, WC_V1, 2.8, 3.0, "wall_white", collide=False)
# 칸막이 + 세면대
box("WC_partition", U(548) - 0.05, U(548) + 0.05, WC_V0 + 2.5, WC_V1 - 0.2, 0, 2.2, "wall_charcoal")
for i in range(3):
    vv = V(725) + i * 0.9
    box(f"WC_sink_{i}", U(548) + 0.05, U(548) + 0.6, vv - 0.3, vv + 0.3, 0.8, 0.9, "wall_white", collide=False)
for i in range(4):
    vv = V(760) + i * 1.3
    box(f"WC_stall_{i}", U(560), WC_U1, vv - 0.04, vv + 0.04, 0, 2.0, "wall_charcoal")
box("WC_mirror", WC_U1 - 0.05, WC_U1, V(715), V(745), 1.1, 2.0, "metal", collide=False)
plane("SIGN_wc", (U(478) + U(503)) / 2, WC_V0 - 0.16, 2.75, 2.2, 0.35, "S", "sign_wc", offset=0.0, merge=True)
box("WC_hydrant", U(420), U(445), WC_V0 - 0.35, WC_V0 - 0.15, 0.6, 1.8, "red_box")
plane("WC_hydrant_label", U(432.5), WC_V0 - 0.35, 1.55, 1.6, 0.3, "S", "sign_hydrant", offset=0.005, merge=True)
light("LIGHT_wc", (WC_U0 + WC_U1) / 2, (WC_V0 + WC_V1) / 2, 2.6, intensity=4.0, distance=10.0, color=(0.95, 0.97, 1.0))

# ---------------------------------------------------------------- 엘리베이터 홀
EL_U0, EL_U1, EL_V0, EL_V1 = U(285), U(400), V(690), V(840)
box("EL_block", EL_U0, EL_U1, EL_V0, EL_V1, 0, LOBBY_H, "wall_stone")
for i, uc in enumerate([U(312), U(350)]):
    box(f"EL_door_{i}", uc - 0.75, uc + 0.75, EL_V0 - 0.04, EL_V0, 0, 2.3, "metal", collide=False)
    box(f"EL_frame_{i}", uc - 0.85, uc + 0.85, EL_V0 - 0.06, EL_V0, 2.3, 2.42, "steel_dark", collide=False)
    box(f"EL_ind_{i}", uc - 0.12, uc + 0.12, EL_V0 - 0.07, EL_V0, 2.55, 2.7, "emit_warm", collide=False)
plane("SIGN_lotte_el", (EL_U0 + EL_U1) / 2, EL_V0, 3.75, 6.2, 1.55, "N", "sign_lotte", offset=0.02, merge=False)
# 남쪽 외벽 동쪽 연결
wall("W_south_e", U(290), SOUTH_V, U(290), EL_V1, 0, LOBBY_H, "wall_stone")
wall("W_south_e2", U(290), EL_V1, EL_U0, EL_V1, 0, LOBBY_H, "wall_stone")

# ---------------------------------------------------------------- 에스컬레이터 (하행, 진입 불가)
ES_U0, ES_U1 = U(252), U(283)
for i in range(16):
    z0 = -0.2 - i * 0.2
    box(f"ES_step_{i}", ES_U0 + 0.15, ES_U1 - 0.15, SOUTH_V + 0.3 + i * 0.4, SOUTH_V + 0.7 + i * 0.4, z0 - 0.2, z0, "steel_dark", collide=False)
for sgn, uu in ((1, ES_U0), (-1, ES_U1)):
    box(f"ES_side_{sgn}", uu - 0.08, uu + 0.08, SOUTH_V - 1.5, SOUTH_V + 7.0, -3.4, 1.0, "glass", collide=True)
    box(f"ES_rail_{sgn}", uu - 0.1, uu + 0.1, SOUTH_V - 1.5, SOUTH_V + 7.0, 1.0, 1.08, "black_plastic", collide=False)
box("ES_landing", ES_U0, ES_U1, SOUTH_V - 1.5, SOUTH_V + 0.3, -0.2, 0.0, "steel_dark", floor=True, collide=False)
box("ES_block", ES_U0, ES_U1, SOUTH_V + 0.6, SOUTH_V + 0.7, 0, 2.0, "invisible", props={"invisible": 1})
empty("SPAWN", (ES_U0 + ES_U1) / 2, SOUTH_V - 2.5, 0.0, {"spawn": 1, "yaw": 0.0, "facing": "-z"})

# ---------------------------------------------------------------- 창가 바 & 하이테이블 & 로비 전광판
# 창가 바 카운터
box("BAR_window", W_GLASS_U + 0.1, W_GLASS_U + 0.75, V(548), SOUTH_V - 0.4, 1.0, 1.06, "wood", collide=False)
box("BAR_window_leg", W_GLASS_U + 0.1, W_GLASS_U + 0.2, V(548), SOUTH_V - 0.4, 0, 1.0, "wood")
box("BAR_topblock", 0.0, U(128), V(510), V(545), 0, LOBBY_H, "wall_charcoal")
box("BAR_col", U(112), U(133), V(707), V(732), 0, LOBBY_H, "wall_stone")


def stool(name, cu, cv):
    cylinder(name + "_seat", cu, cv, 0.72, 0.76, 0.18, "black_plastic", seg=12)
    for dx, dy in ((-0.13, -0.13), (0.13, -0.13), (0.13, 0.13), (-0.13, 0.13)):
        box(name + f"_leg{dx}{dy}", cu + dx - 0.015, cu + dx + 0.015, cv + dy - 0.015, cv + dy + 0.015, 0, 0.72, "black_plastic", collide=False)


for i in range(18):
    vv = V(560) + i * 1.1
    if vv > SOUTH_V - 0.8:
        break
    stool(f"ST_w{i}", W_GLASS_U + 1.05, vv)
# 중앙 하이테이블
HT_U0, HT_U1 = U(178), U(192)
box("BAR_high", HT_U0, HT_U1, V(520), V(835), 1.0, 1.06, "wood", collide=False)
box("BAR_high_base", HT_U0 + 0.35, HT_U1 - 0.35, V(520), V(835), 0, 1.0, "black_plastic")
for i in range(20):
    vv = V(530) + i * 1.15
    if vv > V(830):
        break
    stool(f"ST_a{i}", HT_U0 - 0.45, vv)
    stool(f"ST_b{i}", HT_U1 + 0.45, vv)
# 로비 전광판 (남쪽 벽, 북쪽을 바라봄)
LED_W, LED_H = 5.6, 3.15
LED_CU = (U(100) + U(250)) / 2
box("LED_frame", LED_CU - LED_W / 2 - 0.12, LED_CU + LED_W / 2 + 0.12, SOUTH_V - 0.12, SOUTH_V, 1.55, 1.55 + LED_H + 0.24, "black_plastic", collide=False)
plane("LED_LOBBY", LED_CU, SOUTH_V - 0.12, 1.67 + LED_H / 2, LED_W, LED_H, "N", "led_black", offset=0.01,
      props={"display": "lobby", "w": LED_W, "h": LED_H})
# 대형 스탠디(손 모양 대신 단순 판넬)
# 스탠디 (포스터 입간판)
box("STANDEE_base", LED_CU + LED_W / 2 + 0.55, LED_CU + LED_W / 2 + 1.95, SOUTH_V - 1.25, SOUTH_V - 0.95, 0, 0.08, "black_plastic")
box("STANDEE_board", LED_CU + LED_W / 2 + 0.6, LED_CU + LED_W / 2 + 1.9, SOUTH_V - 1.12, SOUTH_V - 1.08, 0.08, 1.94, "black_plastic")
plane("STANDEE", LED_CU + LED_W / 2 + 1.25, SOUTH_V - 1.12, 1.01, 1.28, 1.84, "N", "posters", offset=0.005, merge=True, uv=poster_uv(6))
# 로비 북벽(4관 남쪽 블록) 포스터 라이트박스
for i in range(3):
    poster_box(f"P_lobby_{i}", AUD_U1 - 1.2 - i * 1.8, V(340) - 0.15, 1.75, "S", i + 1)
# 엘리베이터 홀 양옆
poster_box("P_el_1", EL_U1 - 0.9, EL_V0, 1.75, "N", 3)

# ---------------------------------------------------------------- 로비 소품
# 줄서기 스탠션
for i in range(6):
    cylinder(f"STN_{i}", SW_U0 - 3.5, V(420) + i * 1.3, 0, 0.95, 0.04, "metal", seg=8)
    cylinder(f"STN_base_{i}", SW_U0 - 3.5, V(420) + i * 1.3, 0, 0.03, 0.17, "metal", seg=12)
# 대기 벤치
for i in range(3):
    box(f"BENCH_{i}", U(200) + i * 3.2, U(200) + i * 3.2 + 2.2, V(440), V(452), 0, 0.45, "wood", top_mat="wood")
# 천장 다운라이트 (발광 원판)
for i in range(7):
    for j in range(8):
        cu = 1.5 + i * 3.6
        cv = V(355) + j * 3.6
        if cu > U(380) or cv > SOUTH_V - 1:
            continue
        cylinder(f"DL_{i}_{j}", cu, cv, LOBBY_H - 0.02, LOBBY_H, 0.1, "emit_white", seg=10)
for (cu, cv) in [(U(410), V(300)), (U(500), V(300)), (U(500), V(370)), (U(410), V(370)), (U(450), V(665)), (U(560), V(665))]:
    cylinder(f"DL_e_{cu:.0f}_{cv:.0f}", cu, cv, LOBBY_H - 0.02, LOBBY_H, 0.1, "emit_white", seg=10)
# 로비 조명 배치
for i, (cu, cv) in enumerate([(5, V(400)), (12, V(400)), (18, V(420)), (5, V(560)), (12, V(600)), (6, V(780)), (12, V(820)), (20, V(670))]):
    light(f"LIGHT_lobby_{i}", cu, cv, 4.6, intensity=10.0, distance=16.0, color=(1, 0.92, 0.82))
light("LIGHT_led", LED_CU, SOUTH_V - 3, 3.5, intensity=3.0, distance=8.0, color=(0.6, 0.6, 1.0))
empty("ZONE_LOBBY", 19, 33, 2.5, {"zone": "lobby", "su": 40, "sv": 66, "sz": 5})

# ---------------------------------------------------------------- 병합 & 내보내기
def merge_static():
    groups = {}
    for ob in ALL:
        key = (tuple(m.name for m in ob.data.materials), int(ob.get("collide", 0)), int(ob.get("floor", 0)), int(ob.get("invisible", 0)))
        groups.setdefault(key, []).append(ob)
    for (mats, c, f, inv), obs in groups.items():
        if len(obs) == 1:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for o in obs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = obs[0]
        bpy.ops.object.join()
        j = bpy.context.view_layer.objects.active
        j.name = f"STATIC_{'_'.join(sorted(set(mats)))}_c{c}f{f}{'_inv' if inv else ''}"
        j["collide"] = c
        j["floor"] = f
        if inv:
            j["invisible"] = 1
    # 머티리얼 슬롯 정리(동일 머티리얼 중복 슬롯 → 하나로)
    for ob in COL.objects:
        if ob.type == "MESH":
            ob.select_set(False)


merge_static()

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    export_extras=True,
    export_yup=True,
    export_apply=True,
    export_lights=False,
    export_cameras=False,
    export_image_format="AUTO",
    export_materials="EXPORT",
)
print("EXPORTED", OUT_GLB, os.path.getsize(OUT_GLB) // 1024, "KB")

# ---------------------------------------------------------------- 미리보기 렌더 (--render)
if "--render" in ARGS:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.eevee.taa_render_samples = 16
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.03, 0.035, 1)
    scene.world = world
    # 미리보기 전용: LIGHT_ 엠프티 → 실제 포인트 라이트
    for o in list(COL.objects):
        if o.type == "EMPTY" and "light" in o.keys():
            ld = bpy.data.lights.new(o.name + "_L", "POINT")
            ld.color = tuple(o["color"])[:3]
            ld.energy = float(o["intensity"]) * 60
            ld.shadow_soft_size = 0.3
            lo = bpy.data.objects.new(o.name + "_L", ld)
            lo.location = o.location
            scene.collection.objects.link(lo)
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    # 천장 숨기기용(탑뷰)
    shots = {
        "top": ((19.5, -33, 90), (0, 0, 0), 60, True),
        "theater_back": ((AUD_U0 + 1.0, -(AUD_V0 + 2.0), 6.2), (math.radians(78), 0, math.radians(-102)), 70, False),
        "theater_front": ((AUD_U1 - 3, -(AUD_V1 - 1.5), 1.8), (math.radians(88), 0, math.radians(65)), 75, False),
        "lobby_from_escalator": (((ES_U0 + ES_U1) / 2, -(SOUTH_V - 2), 1.7), (math.radians(88), 0, math.radians(-10)), 75, False),
        "lobby_door4": ((U(420), -V(380), 1.7), (math.radians(90), 0, 0), 75, False),
        "sweet": ((U(300), -V(500), 1.7), (math.radians(90), 0, math.radians(-90)), 75, False),
    }
    ceilings = [o for o in COL.objects if o.name.startswith("STATIC_ceiling") or "ceiling" in o.name]
    for nm, (loc, rot, fov, hide_ceiling) in shots.items():
        for o in ceilings:
            o.hide_render = hide_ceiling
        scene.render.resolution_y = 1280 if nm == "top" else 720
        if nm == "top":
            cam_data.type = "ORTHO"
            cam_data.ortho_scale = 68
            cam.rotation_euler = (0, 0, 0)
        else:
            cam_data.type = "PERSP"
            cam_data.angle = math.radians(fov)
            cam.rotation_euler = Euler(rot)
        cam.location = loc
        scene.render.filepath = os.path.join(HERE, f"preview_{nm}.png")
        bpy.ops.render.render(write_still=True)
        print("rendered", nm)
