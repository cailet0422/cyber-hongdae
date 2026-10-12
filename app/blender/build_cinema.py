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
make_mat("bronze", color=(0.42, 0.3, 0.17), rough=0.35, metal=0.85)
make_mat("metal_gray", color=(0.5, 0.51, 0.52), rough=0.45, metal=0.6)
make_mat("esc_yellow", color=(0.95, 0.7, 0.05), rough=0.5)
make_mat("leather", color=(0.045, 0.045, 0.05), rough=0.42)
make_mat("wall_beige", color=(0.8, 0.72, 0.58), rough=0.7)
make_mat("belt_pink", color=(0.9, 0.1, 0.4), rough=0.5)
make_mat("claw_pink", color=(0.95, 0.62, 0.76), rough=0.4)
make_mat("counter_lit", color=(0.85, 0.78, 0.66), rough=0.5, emit=(1.0, 0.8, 0.55), emit_strength=0.6)
make_mat("fridge_lit", color=(0.85, 0.9, 0.95), rough=0.3, emit=(0.8, 0.9, 1.0), emit_strength=0.8)
# 텍스처 사인(발광)
make_mat("sign_sweet", tex="sign_sweet.jpg", emit=(1, 1, 1), emit_strength=2.5, emit_tex=True)
make_mat("menu_boards", tex="menu_boards_ai.png" if tex_path("menu_boards_ai.png") else "menu_boards.jpg", emit=(1, 1, 1), emit_strength=1.4, emit_tex=True)
make_mat("sign_lotte", tex="sign_lotte.png", alpha_tex=True, emit=(1, 1, 1), emit_strength=1.5, emit_tex=True)
make_mat("sign_lotte_r", tex="sign_lotte_r.png", alpha_tex=True, emit=(1, 1, 1), emit_strength=1.5, emit_tex=True)
make_mat("sign_exit", tex="sign_exit.jpg", emit=(1, 1, 1), emit_strength=2.0, emit_tex=True)
make_mat("sign_exit_l", tex="sign_exit_l.jpg", emit=(1, 1, 1), emit_strength=2.0, emit_tex=True)
make_mat("sign_exit_door", tex="sign_exit_door.jpg", emit=(1, 1, 1), emit_strength=2.0, emit_tex=True)
make_mat("kiosk_screens", tex="kiosk_screens.jpg", emit=(1, 1, 1), emit_strength=1.2, emit_tex=True)
make_mat("posters", tex="posters_ai.jpg" if tex_path("posters_ai.jpg") else "posters.jpg", emit=(1, 1, 1), emit_strength=0.9, emit_tex=True)
make_mat("city_night", tex="city_night_ai.jpg" if tex_path("city_night_ai.jpg") else "city_night.jpg", emit=(1, 1, 1), emit_strength=1.0, emit_tex=True)
make_mat("graffiti", tex="graffiti_ai.jpg", rough=0.9) if tex_path("graffiti_ai.jpg") else make_mat("graffiti", tex="graffiti.png", alpha_tex=True, rough=0.9)
make_mat("sign_babyseat", tex="sign_babyseat.png", alpha_tex=True, emit=(1, 1, 1), emit_strength=1.0, emit_tex=True)
make_mat("sign_4", tex="sign_4.png", alpha_tex=True, emit=(1, 1, 1), emit_strength=1.5, emit_tex=True)
make_mat("sign_5", tex="sign_5.png", alpha_tex=True, emit=(1, 1, 1), emit_strength=1.5, emit_tex=True)
make_mat("sign_5_door", tex="sign_5_door.png", alpha_tex=True, emit=(1, 1, 1), emit_strength=1.5, emit_tex=True)
make_mat("sign_6", tex="sign_6.png", alpha_tex=True, emit=(1, 1, 1), emit_strength=1.5, emit_tex=True)
make_mat("sign_wc", tex="sign_wc.png", alpha_tex=True, emit=(1, 1, 1), emit_strength=1.2, emit_tex=True)
make_mat("sign_hydrant", tex="sign_hydrant.png", rough=0.4)
make_mat("sign_kwangeum", tex="sign_kwangeum.png", alpha_tex=True, rough=0.6)
make_mat("glow_cone", tex="glow_cone.png", alpha_tex=True, emit=(1, 1, 1), emit_strength=1.5, emit_tex=True)
make_mat("sign_down", tex="sign_down.png", alpha_tex=True, emit=(1, 1, 1), emit_strength=0.9, emit_tex=True)
make_mat("kiosk_atlas", tex="kiosk_atlas.jpg", emit=(1, 1, 1), emit_strength=0.7, emit_tex=True)
make_mat("sign_boxoffice", tex="sign_boxoffice.png", alpha_tex=True, emit=(1, 1, 1), emit_strength=1.2, emit_tex=True)
make_mat("sign_group", tex="sign_group.png", emit=(1, 1, 1), emit_strength=0.8, emit_tex=True)
make_mat("ad_screens", tex="ad_screens.jpg", emit=(1, 1, 1), emit_strength=1.0, emit_tex=True)


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


def prism_vz(name, u0, u1, pts, mat, collide=False, props=None, merge=True):
    """(v, z) 단면 볼록 다각형을 u0~u1로 압출 (에스컬레이터처럼 기울어진 부재용)"""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    a = [bm.verts.new((u0, -v, z)) for v, z in pts]
    b = [bm.verts.new((u1, -v, z)) for v, z in pts]
    bm.faces.new(a)
    bm.faces.new(b[::-1])
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        bm.faces.new([a[i], a[j], b[j], b[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    _uv_world(bm, [mat], me)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MATS[mat])
    p = dict(props or {})
    if collide:
        p["collide"] = 1
    return _new_obj(name, me, p, merge)


def prism_uz(name, v0, v1, pts, mat, collide=False):
    """(u, z) 단면 볼록 다각형을 v0~v1로 압출 (객석 옆 경사 난간용)"""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    a = [bm.verts.new((u, -v0, z)) for u, z in pts]
    b = [bm.verts.new((u, -v1, z)) for u, z in pts]
    bm.faces.new(a)
    bm.faces.new(b[::-1])
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        bm.faces.new([a[i], a[j], b[j], b[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    _uv_world(bm, [mat], me)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MATS[mat])
    return _new_obj(name, me, {"collide": 1} if collide else None, True)


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
# 4관 출구 통로: 스크린 옆 남쪽 문 → 4관 남쪽 벽 따라 서쪽(매점 뒤) → 4관 서쪽 벽 따라 북쪽 → 포스터 복도 맨 끝 오른쪽으로 나옴
PC_U1 = AUD_U0 - TH - 1.275                  # 포스터 복도 동쪽 면 (출구 통로에 1.275m 내줌)
XP_U0, XP_U1 = PC_U1 + 0.15, AUD_U0 - TH    # 서쪽 출구 통로 안쪽 (포스터 복도와의 칸막이 두께 0.15)
XS_V1 = AUD_V1 + TH + 1.3                    # 남쪽 출구 통로 남쪽 면 (그 남쪽이 매점)
# 하행 에스컬레이터 보이드: 창가 바(서쪽)와 맞은편 바 테이블(동쪽) 사이. 탑승구는 북쪽, 남쪽으로 내려감
VOID_U0, VOID_U1 = U(129), U(192)        # 보이드 서쪽 끝(창가 통로 쪽 유리 난간) / 동쪽 끝(맞은편 바 테이블)
ES_U0, ES_U1 = VOID_U0 + 0.1, VOID_U0 + 1.85   # 에스컬레이터 트러스 폭
ES_CU = (ES_U0 + ES_U1) / 2
ES_V0 = V(522)                           # 상부 콤플레이트(탑승 지점)
ES_INC0 = ES_V0 + 1.6                    # 경사 시작
ES_DROP = 7.0                            # 10층 → 아래층 층고
ES_INC1 = ES_INC0 + ES_DROP / math.tan(math.radians(30))
ES_V1 = ES_INC1 + 1.6                    # 하부 콤플레이트
VOID_V0, VOID_V1 = ES_INC0, V(838)
# 보이드 위 올린 천장(코퍼)
CF_U0, CF_U1, CF_V0, CF_V1, CF_H = VOID_U0, VOID_U1 + 0.3, V(510), VOID_V1 + 0.3, LOBBY_H + 1.6

# ---------------------------------------------------------------- 바닥 & 천장
# 로비 전체 바닥 (진회색 타일) - 에스컬레이터 보이드 자리는 비움
for nm, a, b, c, d in (("w", 0.0, VOID_U0, V(340) - 0.15, SOUTH_V), ("e", VOID_U1, U(290), V(340) - 0.15, SOUTH_V),
                       ("e2", U(290), U(390) + 0.15, V(340) - 0.15, V(840)),   # 엘리베이터 홀 남쪽 창 밖은 건물 밖
                       ("n", VOID_U0, VOID_U1, V(340) - 0.15, VOID_V0), ("s", VOID_U0, VOID_U1, VOID_V1, SOUTH_V)):
    box(f"F_lobby_{nm}", a, b, c, d, -0.2, 0.0, "floor_dark", floor=True, collide=False)
box("F_lobby_east", U(390) + 0.15, U(610), V(650), V(683), -0.2, 0.0, "floor_dark", floor=True, collide=False)
# 4관 입구 앞 우드 타일 존 + 6관 알코브
box("F_wood", U(390) + 0.15, U(555), V(265), V(395), -0.2, 0.0, "floor_wood", floor=True, collide=False)
box("F_wood2", U(390) + 0.15, U(415), V(395), V(650), -0.2, 0.0, "floor_dark", floor=True, collide=False)
# 서쪽 복도(포스터 복도)
box("F_westcor", 0.0, PC_U1, V(45), V(340) - 0.15, -0.2, 0.0, "floor_wood", floor=True, collide=False)
# 4관 동쪽/북쪽 입장 복도 (카펫)
box("F_entry_e", AUD_U1 + TH, U(435), V(45), V(265), -0.2, 0.0, "carpet_dark", floor=True, collide=False)
box("F_entry_n", U(330), AUD_U1 + TH, V(45), AUD_V0 - TH, -0.2, 0.0, "carpet_dark", floor=True, collide=False)
# 5관 복도
box("F_5cor", U(465) + 0.15, U(555), V(45), V(265), -0.2, 0.0, "floor_wood", floor=True, collide=False)
# 화장실
box("F_wc", U(400), U(610), V(683) + 0.15, V(840), -0.2, 0.0, "wall_white", floor=True, collide=False)

# 천장 (4관 박스 제외)
for nm, a, b, c, d in (("w", 0.0, CF_U0, V(340), SOUTH_V), ("e", CF_U1, U(290), V(340), SOUTH_V), ("e2", U(290), U(610), V(340), V(840)),
                       ("n", CF_U0, CF_U1, V(340), CF_V0), ("s", CF_U0, CF_U1, CF_V1, SOUTH_V)):
    box(f"C_lobby_{nm}", a, b, c, d, LOBBY_H, LOBBY_H + 0.2, "ceiling_gray", collide=False)
# 보이드 위 코퍼: 브론즈 테두리 + 간접조명
box("C_coffer", CF_U0, CF_U1, CF_V0, CF_V1, CF_H, CF_H + 0.2, "ceiling_gray", collide=False)
for nm, a, b, c, d in (("w", CF_U0 - 0.1, CF_U0, CF_V0, CF_V1), ("e", CF_U1, CF_U1 + 0.1, CF_V0, CF_V1),
                       ("n", CF_U0, CF_U1, CF_V0 - 0.1, CF_V0), ("s", CF_U0, CF_U1, CF_V1, CF_V1 + 0.1)):
    box(f"C_coffer_{nm}", a, b, c, d, LOBBY_H - 0.25, CF_H, "bronze", collide=False)
box("C_coffer_cove_w", CF_U0, CF_U0 + 0.05, CF_V0, CF_V1, CF_H - 0.12, CF_H - 0.04, "emit_warm", collide=False)
box("C_coffer_cove_e", CF_U1 - 0.05, CF_U1, CF_V0, CF_V1, CF_H - 0.12, CF_H - 0.04, "emit_warm", collide=False)
box("C_lobby_ne", AUD_U1 + TH, U(610), V(265), V(340), LOBBY_H, LOBBY_H + 0.2, "ceiling_gray", collide=False)
box("C_entry", AUD_U1 + TH, U(555), V(45), V(265), COR_H, COR_H + 0.2, "ceiling_dark", collide=False)
box("C_entry_n", U(330), AUD_U1 + TH, V(45), AUD_V0 - TH, COR_H, COR_H + 0.2, "ceiling_dark", collide=False)
box("C_westcor", 0.0, PC_U1, V(45), V(340), COR_H + 0.6, COR_H + 0.8, "ceiling_dark", collide=False)
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
plane("BG_city_s", 4.0, SOUTH_V + 20.0, 6.0, 70, 40, "N", "city_night", merge=False)
# 북쪽 외벽
wall("W_north", -0.3, -0.15 + V(45) - 0.15, U(560), -0.15 + V(45) - 0.15, 0, LOBBY_H, "wall_charcoal")
# 남쪽 외벽: 서쪽(창가 바 ~ 맞은편 바 테이블 끝)은 통유리, 동쪽은 석재 + 에어컨장 개구부
AC_U1 = U(290) - 0.4                      # 동쪽 벽(포스터 벽) 바로 옆
AC_U0, AC_TOP = AC_U1 - 0.95, 2.3
box("W_glass_s", W_GLASS_U, VOID_U1, SOUTH_V + 0.12, SOUTH_V + 0.18, 0.0, LOBBY_H, "glass", collide=True)
for i in range(6):
    uu = W_GLASS_U + i * (VOID_U1 - W_GLASS_U) / 5
    box(f"W_mullion_s{i}", uu - 0.04, uu + 0.04, SOUTH_V + 0.09, SOUTH_V + 0.21, 0, LOBBY_H, "steel_dark", collide=False)
box("W_glass_s_sill", W_GLASS_U, VOID_U1, SOUTH_V + 0.05, SOUTH_V + 0.25, 0.0, 0.25, "steel_dark")
box("W_glass_s_top", W_GLASS_U, VOID_U1, SOUTH_V + 0.05, SOUTH_V + 0.25, LOBBY_H - 0.3, LOBBY_H, "steel_dark", collide=False)
wall_with_openings("W_south", "u", SOUTH_V + 0.15, VOID_U1, U(290), 0, LOBBY_H, "wall_stone", [(AC_U0, AC_U1, AC_TOP)])
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
# 남쪽 벽: 북쪽 문 바로 맞은편에 출구 문 (→ 4관 출구 통로)
XD_U0, XD_U1, XD_H = ENT_U0, ENT_U1, 2.3
wall_with_openings("A_wall_s", "u", AUD_V1 + TH / 2, AUD_U0 - TH, AUD_U1 + TH, 0, AUD_H, "wall_theater", [(XD_U0, XD_U1, XD_H)])
# 4관 남쪽 띠 (로비 북벽): 서쪽 포스터 복도 끝부터 전부 Sweet# 매점, 동쪽 끝에 직원 대기공간 (아래 매점 구획)
STRIP_V0, STRIP_V1 = AUD_V1 + TH, V(340) - 0.15
box("B_strip_w", PC_U1, AUD_U0, XS_V1, STRIP_V1, 0, LOBBY_H, "wall_stone")   # 포스터 복도 동쪽 벽 (매점 서쪽 벽, 북쪽은 출구 통로)
# 4관 출구 복도(서쪽, U(390)~U(435))와 입구 통로(동쪽, U(435)~U(465)) - 두 복도는 북쪽 끝에서 만나 4관 북쪽 복도로 이어짐
IN_U0, IN_U1 = U(435) + 0.3, U(465) + 0.15     # 입구 통로 내부
wall_with_openings("E_cor_east", "v", U(435) + 0.15, V(45), V(265), 0, COR_H, "wall_charcoal", [(V(45), V(45) + 2.2, COR_H)])
box("E_in_east", IN_U1, IN_U1 + 0.3, V(45), V(220), 0, COR_H, "wall_charcoal")   # 5관 복도와 경계 (남쪽은 베이비시트 선반)
box("F_entry_in", IN_U0, IN_U1, V(45), V(265), -0.2, 0.0, "carpet_dark", floor=True, collide=False)
# 북쪽 복도 서쪽 끝 막음 (입장 복도: 입구 통로 → 북쪽 복도 → 스크린 옆 북쪽 문)
wall("E_cor_nend", U(330), V(45), U(330), AUD_V0 - TH, 0, COR_H, "wall_charcoal")
# 4관 출구 파사드 (v=V(270)) - 문 개구부 U(398)~U(428). 문 왼쪽은 Sweet# 옆 직원 대기공간, 광음시네마 벽 오른쪽이 입구 통로
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
# 출구 사인 (문 위, 로비 쪽)
plane("SIGN_exit_door4", (DOOR_U0 + DOOR_U1) / 2, FAC_V + 0.2, 2.68, 0.6, 0.3, "S", "sign_exit", offset=0.01, merge=True)
# 문과 직원 대기공간 사이 어두운 타일 기둥면
box("E_pillar_clad", AUD_U1 + TH, AUD_U1 + TH + 0.03, FAC_V + 0.2, STRIP_V0 + 0.3, 0, LOBBY_H, "wall_charcoal", collide=False)
# 복도 내부: 벽등과 출구 사인
for i, vv in enumerate([V(240), V(190), V(140), V(90)]):
    plane(f"L_cor_glow_{i}", U(435) - 0.01, vv, 1.9, 0.9, 1.6, "W", "glow_cone", offset=0.0)
    if i < 3:
        light(f"LIGHT_cor_{i}", U(413), vv + 1.9, COR_H - 0.05, kind="spot", angle=65, intensity=4.5, distance=6.0, color=(1, 0.8, 0.6))
light("LIGHT_cor_n", (U(330) + AUD_U1) / 2, (V(45) + AUD_V0 - TH) / 2, COR_H - 0.05, kind="spot", angle=65, intensity=4.5, distance=6.0, color=(1, 0.8, 0.6))
plane("SIGN_exit_cor", (DOOR_U0 + DOOR_U1) / 2, FAC_V - 0.2, 2.75, 0.6, 0.3, "N", "sign_exit_door", offset=0.01, merge=True)
# 4관 입구 통로 (광음시네마 벽과 베이비시트 사이로 들어가 안쪽 문을 지나 북쪽 끝에서 출구 복도와 합류)
IND_V = V(200)
IND_U0, IND_U1 = IN_U0 + 0.4, IN_U1 - 0.4
box("IN_wall_l", IN_U0, IND_U0, IND_V - 0.1, IND_V + 0.1, 0, COR_H, "wall_charcoal")
box("IN_wall_r", IND_U1, IN_U1, IND_V - 0.1, IND_V + 0.1, 0, COR_H, "wall_charcoal")
box("IN_lintel", IND_U0, IND_U1, IND_V - 0.1, IND_V + 0.1, 2.3, COR_H, "wall_charcoal", collide=False)
box("IN_frame", IND_U0 - 0.06, IND_U1 + 0.06, IND_V + 0.1, IND_V + 0.13, 2.24, 2.32, "steel_dark", collide=False)
box("IN_door", IND_U0, IND_U0 + 0.05, IND_V - 1.25, IND_V - 0.1, 0, 2.25, "metal_gray", collide=False)   # 안쪽으로 열린 문짝
plane("SIGN_4_in", (IND_U0 + IND_U1) / 2, IND_V + 0.1, 2.72, 1.0, 0.5, "S", "sign_4", offset=0.01, merge=True)
for i, vv in enumerate([V(245), V(150), V(70)]):
    plane(f"L_in_glow_{i}", IN_U0 + 0.01, vv, 1.9, 0.9, 1.6, "E", "glow_cone", offset=0.0)
    light(f"LIGHT_in_{i}", (IN_U0 + IN_U1) / 2, vv, COR_H - 0.05, kind="spot", angle=65, intensity=4.5, distance=6.0, color=(1, 0.8, 0.6))

# ---------------------------------------------------------------- 4관 내부 (광음시네마)
# 바닥: 앞쪽 평지(카펫)
box("A_floor_front", AUD_U0, AUD_U1, AUD_V0, AUD_V1, -0.2, 0.0, "carpet", floor=True, collide=False)
box("A_ceiling", AUD_U0 - TH, AUD_U1 + TH, AUD_V0 - TH, AUD_V1 + TH, AUD_H, AUD_H + 0.2, "ceiling_dark", collide=False)
# 내부 벽 마감 (석재 흡음벽) - 벽 안쪽에 얇은 판
# 남벽 판은 출구 문 개구부를 피해서 구성
box("A_in_s1", AUD_U0, XD_U0, AUD_V1 - 0.08, AUD_V1, 0, AUD_H, "wall_theater", collide=False, faces="-s")
box("A_in_s2", XD_U0, AUD_U1 - 0.6, AUD_V1 - 0.08, AUD_V1, XD_H, AUD_H, "wall_theater", collide=False, faces="-s")
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
for i, cv in enumerate([5.9, 9.1, 10.3, 11.5, 12.7, 15.7]):
    cu = AUD_U1 - 2.4 - (0.4 if i in (0, 5) else 0)
    box(f"A_sub_{i}", cu - 0.42, cu + 0.42, cv - 0.42, cv + 0.42, 0.1, 1.0, "black_plastic")
    box(f"A_sub_base_{i}", cu - 0.5, cu + 0.5, cv - 0.5, cv + 0.5, 0.0, 0.1, "emit_purple", collide=False)
    box(f"A_sub_top_{i}", cu - 0.1, cu + 0.1, cv - 0.06, cv + 0.06, 1.0, 1.01, "metal", collide=False)
    light(f"LIGHT_sub_{i}", cu, cv, 0.15, color=(0.55, 0.25, 1.0), intensity=1.6, distance=2.5, theater=1)
# 남측벽 그래피티 벽화 (스크린 가까운 쪽)
plane("A_graffiti", AUD_U1 - 5.6, AUD_V1 - 0.08, 4.6, 8.4, 4.2, "N", "graffiti", offset=0.03, merge=False)   # 출구 문 위로
# 천장 다운라이트 (작은 발광점)
for i in range(6):
    for j in range(5):
        cylinder(f"A_dl_{i}_{j}", AUD_U0 + 1.5 + i * 2.9, AUD_V0 + 1.5 + j * 3.0, AUD_H - 0.02, AUD_H, 0.07, "emit_white", seg=8)
# 영사실 창 (뒷벽 상단)
box("A_proj_win", AUD_U0, AUD_U0 + 0.1, (AUD_V0 + AUD_V1) / 2 - 0.8, (AUD_V0 + AUD_V1) / 2 + 0.8, 6.3, 7.1, "emit_blue", collide=False)
empty("PROJECTOR", AUD_U0 + 0.15, (AUD_V0 + AUD_V1) / 2, 6.7, {"projector": 1})
# 출구 문 (남쪽, 입장 문 맞은편): 문틀 + 출구 사인 (밖으로 열린 문짝은 출구 통로에)
box("A_xd_head", XD_U0 - 0.06, XD_U1 + 0.06, AUD_V1 - 0.12, AUD_V1 - 0.08, XD_H - 0.04, XD_H + 0.04, "steel_dark", collide=False)
for nm, a in (("l", XD_U0 - 0.06), ("r", XD_U1)):
    box(f"A_xd_jamb_{nm}", a, a + 0.06, AUD_V1 - 0.12, AUD_V1 - 0.08, 0, XD_H, "steel_dark", collide=False)
plane("SIGN_exit_s", (XD_U0 + XD_U1) / 2, AUD_V1 - 0.1, XD_H + 0.4, 0.6, 0.3, "N", "sign_exit_door", offset=0.01, merge=True)
# 극장 조명: 천장 다운라이트 자리에서 아래로 비추는 스포트 (천장이 하얗게 뜨지 않게)
for i, j in ((0, 1), (0, 3), (2, 1), (2, 3), (4, 1), (4, 3)):
    light(f"LIGHT_th_{i}_{j}", AUD_U0 + 1.5 + i * 2.9, AUD_V0 + 1.5 + j * 3.0, AUD_H - 0.05, kind="spot", angle=55, penumbra=0.7,
          intensity=5.0, distance=13.0, color=(1, 0.85, 0.7), theater=1)
empty("ZONE_THEATER4", (AUD_U0 + AUD_U1) / 2, (AUD_V0 + AUD_V1) / 2, AUD_H / 2,
      {"zone": "theater4", "su": AUD_U1 - AUD_U0, "sv": AUD_V1 - AUD_V0, "sz": AUD_H})

# --- 객석 (스타디움식, 사진 기준) ---
# 뒤에서 스크린을 보면: 왼쪽(북) 큰 블록 13석 | 가운데 계단 통로 | 오른쪽(남) 작은 블록 5석 | 남쪽 벽 옆 계단 통로(경사 난간)
# 오른쪽 작은 블록은 앞 두 줄(A·B)이 없다
ROWS = "ABCDEFGHIJK"
ROW_PITCH = 1.05
ROW_A_U = AUD_U1 - 5.5           # 스크린 앞 무대·서브우퍼 공간
RISE0, RISE = 0.3, 0.4
SEAT_PITCH = 0.66
BLK_N = (AUD_V0 + 0.35, 13)      # (블록 북쪽 끝 v, 좌석 수)
AISLE_C0 = BLK_N[0] + BLK_N[1] * SEAT_PITCH
AISLE_C1 = AISLE_C0 + 1.3
BLK_S = (AISLE_C1, 5)
S_BLOCK_FROM = 2                 # 남쪽 블록은 C열부터
WALK_V0 = AISLE_C1 + BLK_S[1] * SEAT_PITCH + 0.1
AISLES = [(AISLE_C0, AISLE_C1), (WALK_V0, AUD_V1)]
SEAT_SPANS = [(AUD_V0, AISLE_C0), (AISLE_C1, WALK_V0)]


def row_u(k):  # k=0 → A열
    return ROW_A_U - k * ROW_PITCH


def row_z(k):
    return RISE0 + k * RISE


def row_front(k):
    return row_u(k) + ROW_PITCH / 2 + (0.15 if k == 0 else 0)


# 단(tier) 블록: 좌석 구역마다 열 플랫폼 + 앞면 스텝 라이트, 통로는 열당 2단 계단
for k in range(len(ROWS)):
    u_front = row_front(k)
    u_back = row_u(k) - ROW_PITCH / 2 if k < len(ROWS) - 1 else AUD_U0
    z = row_z(k)
    for n, (a, b) in enumerate(SEAT_SPANS):
        box(f"T_tier_{k}_{n}", u_back, u_front, a, b, 0, z, "carpet", side_mat="carpet_dark", floor=True)
        box(f"T_tier_led_{k}_{n}", u_front, u_front + 0.01, a, b, z - 0.05, z - 0.03, "emit_step", collide=False)
    # 계단은 이 열 앞면 ~ 다음 열 앞면을 빈틈없이 두 단으로 나눔 (틈이 있으면 0.5m 턱이 생겨 못 올라감)
    st_back = row_front(k + 1) if k < len(ROWS) - 1 else row_u(k) - ROW_PITCH / 2
    for n, (a, b) in enumerate(AISLES):
        for st in range(2):
            z_s = RISE0 / 2 * (st + 1) if k == 0 else row_z(k) - RISE / 2 * (1 - st)
            s_u1 = u_front - st * (u_front - st_back) / 2
            s_u0 = AUD_U0 if (k == len(ROWS) - 1 and st == 1) else s_u1 - (u_front - st_back) / 2
            box(f"T_stair_{k}_{n}_{st}", s_u0, s_u1, a, b, 0, z_s, "carpet_dark", floor=True)
            box(f"T_stair_led_{k}_{n}_{st}", s_u1, s_u1 + 0.01, a + 0.1, b - 0.1, z_s - 0.03, z_s - 0.01, "emit_step", collide=False)
# 남쪽 벽 옆 통로의 경사 난간 + 기둥
RAIL_V = AUD_V1 - 0.12
rail_a, rail_b = (row_front(0), RISE0 + 0.85), (AUD_U0 + 0.3, row_z(len(ROWS) - 1) + 0.85)
prism_uz("T_rail", RAIL_V - 0.03, RAIL_V + 0.03, [rail_a, rail_b, (rail_b[0], rail_b[1] + 0.06), (rail_a[0], rail_a[1] + 0.06)], "metal")
for k in range(0, len(ROWS), 2):
    uu = row_u(k)
    t = (uu - rail_a[0]) / (rail_b[0] - rail_a[0])
    box(f"T_rail_post_{k}", uu - 0.02, uu + 0.02, RAIL_V - 0.02, RAIL_V + 0.02, row_z(k) - RISE / 2, rail_a[1] + t * (rail_b[1] - rail_a[1]), "metal", collide=False)


def aud_floor(u):
    """상영관 안 u 위치의 바닥(단) 높이"""
    for k in range(len(ROWS)):
        uc = row_u(k)
        if u >= uc - ROW_PITCH / 2:
            return 0.0 if u > uc + ROW_PITCH / 2 + (0.15 if k == 0 else 0) else row_z(k)
    return row_z(len(ROWS) - 1)


# 측벽 스피커 + 업라이트 글로우: 계단식 객석 높이를 따라 올라감 (뒤쪽에서 단 속에 묻히지 않게)
for side, vv, fac in (("n", AUD_V0 + 0.08, "S"), ("s", AUD_V1 - 0.08, "N")):
    for i in range(5):
        cu = AUD_U1 - 3.5 - i * 3.0
        sgn = 1 if side == "n" else -1
        fz = aud_floor(cu + 1.5)
        g0, g1 = (2.9 if i == 0 else fz + 1.3), min(fz + 5.5, AUD_H - 0.4)   # 스크린 쪽 첫 칸은 양쪽 문 위로
        sz = min(max(4.6, fz + 3.6), AUD_H - 1.2)
        box(f"A_spk_{side}{i}", cu - 0.3, cu + 0.3, vv, vv + sgn * 0.35, sz, sz + 0.8, "black_plastic", collide=False)
        plane(f"A_glow_{side}{i}", cu + 1.5, vv, (g0 + g1) / 2, 1.4, g1 - g0, fac, "glow_cone", offset=0.02)
        box(f"A_uplight_{side}{i}", cu + 1.4, cu + 1.6, vv, vv + sgn * 0.12, g0 - 0.05, g0 + 0.05, "emit_warm", collide=False)

# 좌석 메시: 검은 가죽 좌석 (두툼한 방석, 높은 등받이, 넓은 팔걸이 + 컵홀더). 공유 메시 → 클라이언트에서 인스턴싱
def build_seat_mesh(name):
    bm = bmesh.new()

    def cube(x0, x1, y0, y1, z0, z1, mi, tilt=0.0, pivot=None):
        r = bmesh.ops.create_cube(bm, size=1.0)
        vs = r["verts"]
        bmesh.ops.scale(bm, verts=vs, vec=(x1 - x0, y1 - y0, z1 - z0))
        bmesh.ops.translate(bm, verts=vs, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
        if tilt:
            bmesh.ops.rotate(bm, verts=vs, cent=pivot, matrix=Matrix.Rotation(tilt, 3, "Y"))
        for f in {f for v in vs for f in v.link_faces}:
            f.material_index = mi

    def cyl(cx, cy, z0, z1, r, mi, seg=12):
        res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r, depth=z1 - z0)
        bmesh.ops.translate(bm, verts=res["verts"], vec=(cx, cy, (z0 + z1) / 2))
        for f in {f for v in res["verts"] for f in v.link_faces}:
            f.material_index = mi

    # 로컬: +X = 정면(스크린 쪽), Y = 좌우, Z = 위. 원점 = 좌석 바닥 중심.  0 = 가죽, 1 = 검은 플라스틱
    w, tilt, piv = 0.52, -0.2, (-0.32, 0, 0.42)
    cube(-0.32, 0.12, -w / 2 + 0.02, w / 2 - 0.02, 0.0, 0.26, 1)                    # 받침
    cube(-0.30, 0.28, -w / 2, w / 2, 0.26, 0.46, 0)                                   # 두툼한 방석
    cube(0.26, 0.33, -w / 2 + 0.01, w / 2 - 0.01, 0.29, 0.44, 0)                      # 방석 앞 둥근 테
    cube(-0.46, -0.24, -w / 2, w / 2, 0.42, 1.12, 0, tilt=tilt, pivot=piv)            # 등받이
    cube(-0.44, -0.27, -w / 2 + 0.03, w / 2 - 0.03, 1.12, 1.2, 0, tilt=tilt, pivot=piv)  # 등받이 윗단
    cube(-0.5, -0.45, -w / 2 + 0.02, w / 2 - 0.02, 0.38, 1.12, 1, tilt=tilt, pivot=piv)  # 뒤판
    for sy in (-1, 1):
        y = sy * SEAT_PITCH / 2                                                        # 옆 좌석과 같은 자리에 겹침(공유 팔걸이)
        cube(-0.42, 0.26, y - 0.05, y + 0.05, 0.0, 0.62, 1)                           # 팔걸이 옆판
        cube(-0.38, 0.36, y - 0.065, y + 0.065, 0.62, 0.70, 0)                        # 팔걸이 패드
        cyl(0.33, y, 0.62, 0.74, 0.055, 1)                                             # 컵홀더
    me = bpy.data.meshes.new(name)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for loop in f.loops:
            c = loop.vert.co
            loop[uv].uv = (c.y + 0.5, c.z)
    bm.to_mesh(me)
    bm.free()
    for m in ("leather", "black_plastic"):
        me.materials.append(MATS[m])
    return me


SEAT_ME = build_seat_mesh("seat_leather")
seat_count = 0


def place_seat(me, sid, row, num, u, v, z):
    global seat_count
    ob = bpy.data.objects.new(f"SEATMESH_{sid}", me)
    ob.location = (u, -v, z)
    COL.objects.link(ob)
    # 착석 지점 (엉덩이 위치) : 좌석보다 살짝 앞, 방석 위
    empty(f"SEAT_{sid}", u + 0.02, v, z + 0.48, {"seat": sid, "row": row, "num": num, "yaw": 0.0, "facing": "+x"}, 0.15)
    seat_count += 1


# 좌석 번호는 북쪽 벽에서부터 통로를 건너 이어서 매김 (A·B열 1~13, C열 1~17, D~K열 1~18 = 187석)
# 남쪽 블록 첫 줄(C열)은 벽 옆 통로 입구 쪽 한 자리를 비움
for k, r in enumerate(ROWS):
    num = 0
    for blk, (v0, n) in enumerate((BLK_N, BLK_S)):
        if blk == 1 and k < S_BLOCK_FROM:
            continue
        if blk == 1 and k == S_BLOCK_FROM:
            n -= 1
        for i in range(n):
            num += 1
            place_seat(SEAT_ME, f"{r}{num}", r, num, row_u(k) - 0.05, v0 + (i + 0.5) * SEAT_PITCH, row_z(k))
print("seats:", seat_count)

# ---------------------------------------------------------------- 서쪽 포스터 복도 & 키오스크
for i, (a, b) in enumerate([(80, 110), (155, 185), (225, 260), (300, 338)]):
    poster_box(f"P_poster_{i}", 0.0, (V(a) + V(b)) / 2, 1.75, "E", i)
# 복도 맨 끝 (북쪽) 오른쪽 = 4관 출구: 4관 서쪽 벽을 따라 올라온 출구 통로가 여기서 포스터 복도로 나옴 (엘리베이터 홀은 남동쪽 석재 블록 안)
EV_V = V(45) - 0.15                                   # 북쪽 벽 안쪽 면
box("EV_cladding", 0.0, XP_U1, EV_V, EV_V + 0.02, 0, COR_H + 0.6, "wall_stone", collide=False)
wall("EV_wall_e", AUD_U0 - TH / 2, EV_V, AUD_U0 - TH / 2, AUD_V0 - TH, 0, LOBBY_H, "wall_charcoal")   # 출구 통로 끝 동쪽 (4관 북쪽 빈 공간 막음)
box("XP_divider", PC_U1, XP_U0, AUD_V0 - TH, XS_V1, 0, LOBBY_H, "wall_stone")                       # 포스터 복도와 출구 통로 사이 벽
box("EV_cladding_e", PC_U1 - 0.02, PC_U1, AUD_V0 - TH, V(87) + 2.2, 0, COR_H + 0.6, "wall_stone", collide=False)
box("XP_lintel", PC_U1, XP_U1, V(45), AUD_V0 - TH, 2.45, LOBBY_H, "wall_stone", collide=False)        # 출구 개구부 위
plane("SIGN_exit_4", PC_U1, (V(45) + AUD_V0 - TH) / 2, 2.75, 0.6, 0.3, "W", "sign_exit_door", offset=0.01, merge=True)
plane("SIGN_exit_4_l", 0.0, (V(45) + AUD_V0 - TH) / 2, 2.6, 0.6, 0.3, "E", "sign_exit_l", offset=0.01, merge=True)   # 나오면서 보는 사인: 왼쪽(남쪽) 로비
# 서쪽 출구 통로 (4관 서쪽 벽과 포스터 복도 사이, 남→북, 베이지 벽 + 나무 징두리)
box("XP_floor", PC_U1, XP_U1, V(45), XS_V1, -0.2, 0.0, "floor_dark", floor=True, collide=False)
box("XP_ceiling", XP_U0, XP_U1, V(45), XS_V1, 2.45, 2.55, "wall_white", collide=False)
box("XP_clad_w", XP_U0, XP_U0 + 0.02, AUD_V0 - TH, XS_V1, 0, 2.45, "wall_beige", collide=False)
box("XP_clad_e", XP_U1 - 0.02, XP_U1, V(45), XS_V1, 0, 2.45, "wall_beige", collide=False)
box("XP_wains_w", XP_U0 + 0.02, XP_U0 + 0.04, AUD_V0 - TH, XS_V1, 0, 0.95, "wood", collide=False)
box("XP_wains_e", XP_U1 - 0.04, XP_U1 - 0.02, V(45), XS_V1, 0, 0.95, "wood", collide=False)
plane("SIGN_exit_xp_n", (XP_U0 + XP_U1) / 2, AUD_V0, 2.2, 0.6, 0.3, "S", "sign_exit_l", offset=0.0, merge=True)   # 북쪽 끝에서 왼쪽(서쪽)으로
for i, vv in enumerate([AUD_V0 + 1.0, AUD_V0 + 5.5, AUD_V0 + 10.0, AUD_V0 + 14.5]):
    light(f"LIGHT_xp_{i}", (XP_U0 + XP_U1) / 2, vv, 2.35, intensity=2.0, distance=4.5, color=(1, 0.9, 0.75))
for i, vv in enumerate([V(45) + 2.4, V(140), V(230), V(310)]):
    light(f"LIGHT_westcor_{i}", PC_U1 / 2, vv, COR_H + 0.55, kind="spot", angle=65, intensity=5.5, distance=7.0, color=(1, 0.92, 0.82))
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
# 베이비시트 선반: 4관 입구 통로 오른쪽, 로비(남쪽)를 보는 수납장. 그 오른쪽이 5관 복도
BS_U0, BS_U1, BS_V0, BS_V1 = U(471), U(495), V(220), V(268)
BS_F = BS_V1 - 0.4                      # 선반 칸 뒷면
box("BS_body", BS_U0, BS_U1, BS_V0, BS_F, 0, 2.6, "wall_white")
box("BS_side_w", BS_U0, BS_U0 + 0.1, BS_F, BS_V1, 0, 2.6, "wall_white")
box("BS_side_e", BS_U1 - 0.1, BS_U1, BS_F, BS_V1, 0, 2.6, "wall_white")
box("BS_head", BS_U0 + 0.1, BS_U1 - 0.1, BS_F, BS_V1, 2.1, 2.6, "wall_charcoal")
box("BS_clad_w", BS_U0 - 0.02, BS_U0, BS_V0, BS_F, 0, COR_H, "wall_charcoal", collide=False)   # 입구 통로 쪽 면
for j in range(5):
    zz = 0.1 + j * 0.4
    box(f"BS_board_{j}", BS_U0 + 0.1, BS_U1 - 0.1, BS_F, BS_V1 - 0.02, zz, zz + 0.03, "wood", collide=False)
    for k, cu in enumerate([BS_U0 + 0.5, BS_U1 - 0.5]):
        if (j, k) != (4, 1):
            box(f"BS_seat_{j}_{k}", cu - 0.3, cu + 0.3, BS_F + 0.03, BS_F + 0.33, zz + 0.03, zz + 0.33, "blue_seat_shell", collide=False)
plane("BS_sign", (BS_U0 + BS_U1) / 2, BS_V1, 2.35, 1.4, 0.18, "S", "sign_babyseat", offset=0.01, merge=True)
# 5관 문 (복도 북쪽 끝)
box("D_5_door", U(480), U(540), V(45) - 0.02, V(45) + 0.06, 0, 2.4, "steel_dark", collide=False)
plane("SIGN_5", U(510), V(45) + 0.07, 2.8, 1.4, 0.7, "S", "sign_5_door", offset=0.0, merge=True)
plane("SIGN_5_hall", U(510), V(265) - 0.1, 3.4, 1.4, 0.7, "S", "sign_5", offset=0.0, merge=True)
for i, vv in enumerate([V(95), V(200)]):
    light(f"LIGHT_5cor_{i}", U(510), vv, COR_H - 0.05, kind="spot", angle=65, intensity=4.5, distance=6.0)
# 6관 알코브 동쪽 벽 + 6관 문 2개
wall_with_openings("W_6", "v", U(555) + 0.15, V(265), V(395), 0, LOBBY_H, "wall_stone",
                   [(V(268) + 0.2, V(295), 2.4), (V(342), V(366), 2.4)])
for i, (a, b) in enumerate([(V(268) + 0.2, V(295)), (V(342), V(366))]):
    box(f"D_6_door_{i}", U(555) + 0.25, U(555) + 0.32, a, b, 0, 2.4, "steel_dark")
plane("SIGN_6", U(555), (V(295) + V(342)) / 2, 3.2, 1.4, 0.7, "W", "sign_6", offset=0.0, merge=True)
# 광음시네마 벽 블록(출구 문 오른쪽) + 그 오른쪽 4관 입구 통로 위 인방
KWANG_U1 = IN_U0 + 0.75
box("W_kwangeum", IN_U0, KWANG_U1, V(262), FAC_V + 0.2, 0, LOBBY_H, "wall_stone")
box("W_in_lintel", KWANG_U1, BS_U0, V(262), FAC_V + 0.2, COR_H, LOBBY_H, "wall_stone", collide=False)
# 기둥
box("COL_p1", U(441), U(457), V(328), V(344), 0, LOBBY_H, "wall_stone")
box("COL_p2", U(291), U(307), V(522), V(538), 0, LOBBY_H, "wall_stone")
# 알코브 남쪽 = Sweet 블록 북벽

# ---------------------------------------------------------------- Sweet# 매점 (로비 북벽 전체: 포스터 복도 끝 ~ 직원 대기공간)
# 남쪽(로비)을 보는 긴 카운터, 동쪽 끝에 문 달린 작은 직원 대기공간
SW_U0, SW_U1 = AUD_U0, AUD_U1 + TH                   # 매점 서쪽 끝(포스터 복도 동쪽 벽 안쪽) ~ 띠 동쪽 면
SWK_U1 = AUD_U1 - 1.525                              # 매점 동쪽 끝 (그 동쪽은 직원 대기공간)
SC_U0, SC_U1 = SW_U0 + 0.3, SWK_U1 - 0.825           # 남쪽 카운터
SC_MID = (SC_U0 + SC_U1) / 2
SW_PIER_V = STRIP_V1 - 0.85                          # 카운터 오른쪽 기둥(포스터+냉장고) 깊이
KIT_V0 = XS_V1 + 0.1                                 # 주방 뒷벽 (4관 출구 통로 쪽 칸막이 두께 0.1)
box("SW_floor", SW_U0, SWK_U1, KIT_V0, STRIP_V1, -0.2, 0.0, "floor_dark", collide=False)
box("SW_ceiling", SW_U0, SWK_U1, KIT_V0, STRIP_V1 - 0.35, 3.0, 3.1, "ceiling_gray", collide=False)
box("SW_pier_w", SW_U0, SC_U0, STRIP_V1 - 0.35, STRIP_V1, 0, LOBBY_H, "wall_charcoal")
box("SW_pier_se", SC_U1, SWK_U1, SW_PIER_V, STRIP_V1, 0, LOBBY_H, "wall_charcoal")
# 남쪽 메인 카운터 (밝은 전면 + 상판 아래 따뜻한 조명)
box("SW_counter", SC_U0, SC_U1, STRIP_V1 - 0.75, STRIP_V1, 0, 1.06, "counter_lit")
box("SW_counter_top", SC_U0, SC_U1, STRIP_V1 - 0.8, STRIP_V1 + 0.05, 1.06, 1.1, "black_plastic", collide=False)
box("SW_counter_glow", SC_U0, SC_U1, STRIP_V1, STRIP_V1 + 0.03, 0.9, 0.98, "emit_warm", collide=False)
# 카운터 너머로 점프해 들어가지 못하게
box("SW_block_s", SC_U0, SC_U1, STRIP_V1 - 0.1, STRIP_V1, 0, 3.0, "invisible", props={"invisible": 1})
# 주방: 벽돌 뒷벽, 작업대, 팝콘 기계 4대 사이사이 음료 디스펜서
box("SW_brick", SW_U0, SWK_U1, KIT_V0, KIT_V0 + 0.3, 0, 3.0, "brick", collide=False)
box("SW_bench", SC_U0, SWK_U1 - 0.3, KIT_V0 + 0.3, KIT_V0 + 1.0, 0, 0.9, "steel_dark", collide=False)
for i in range(4):
    uc = SC_U0 + 1.1 + i * 3.65
    box(f"SW_popcorn_{i}", uc - 0.55, uc + 0.55, KIT_V0 + 0.35, KIT_V0 + 0.95, 0.9, 2.0, "metal", collide=False)
    box(f"SW_popcorn_glow_{i}", uc - 0.45, uc + 0.45, KIT_V0 + 0.95, KIT_V0 + 0.96, 1.15, 1.85, "emit_warm", collide=False)
    if i < 3:
        box(f"SW_drink_{i}", uc + 1.5, uc + 2.2, KIT_V0 + 0.35, KIT_V0 + 0.9, 0.9, 1.7, "black_plastic", collide=False)
# 카운터 위 POS·픽업 안내
for i in range(6):
    uc = SC_U0 + 0.7 + i * 2.4
    box(f"SW_pos_{i}", uc - 0.17, uc + 0.17, STRIP_V1 - 0.6, STRIP_V1 - 0.5, 1.06, 1.38, "black_plastic", collide=False)
    plane(f"SW_pos_scr_{i}", uc, STRIP_V1 - 0.5, 1.24, 0.3, 0.24, "S", "kiosk_screens", offset=0.005, merge=True, uv=(i % 4 / 4, 0.3, (i % 4 + 1) / 4, 0.7))
box("SW_pickup_stand", SC_U1 - 0.55, SC_U1 - 0.15, STRIP_V1 - 0.6, STRIP_V1 - 0.5, 1.06, 1.8, "black_plastic", collide=False)
plane("SW_pickup_stand_sign", SC_U1 - 0.35, STRIP_V1 - 0.5, 1.68, 0.4, 0.16, "S", "emit_blue", offset=0.005, merge=True)
# 소핏 + Sweet# 간판 + 메뉴 보드 3세트
box("SW_soffit", SW_U0, SC_U1, STRIP_V1 - 0.35, STRIP_V1, 3.0, LOBBY_H, "wall_charcoal", collide=False)
plane("SW_sign", SC_MID, STRIP_V1, 4.0, 5.0, 1.25, "S", "sign_sweet", offset=0.03, merge=False)
box("SW_menu_frame", SC_U0 + 0.15, SC_U1 - 0.15, STRIP_V1 - 0.5, STRIP_V1 - 0.38, 2.2, 2.95, "black_plastic", collide=False)
for i in range(3):
    plane(f"SW_menu_{i}", SC_MID + (i - 1) * 4.6, STRIP_V1 - 0.38, 2.575, 4.4, 0.69, "S", "menu_boards", offset=0.005, merge=True)
# 오른쪽 끝: 포스터 + 음료 냉장고
plane("SW_pier_poster", (SC_U1 + SWK_U1) / 2, STRIP_V1, 2.45, 0.6, 0.86, "S", "posters", offset=0.01, merge=True, uv=poster_uv(2))
box("SW_fridge", SC_U1 + 0.1, SWK_U1 - 0.03, STRIP_V1, STRIP_V1 + 0.65, 0, 1.95, "kiosk_body")
box("SW_fridge_door", SC_U1 + 0.16, SWK_U1 - 0.09, STRIP_V1 + 0.65, STRIP_V1 + 0.67, 0.15, 1.75, "fridge_lit", collide=False)
for i in range(3):
    light(f"LIGHT_sweet_in_{i}", SC_MID + (i - 1) * 4.8, KIT_V0 + 1.8, 2.8, intensity=3.0, distance=6.0, color=(1, 0.75, 0.5))
# 매점 오른쪽 작은 직원 대기공간 (로비 쪽 문, 들어갈 수 없음)
box("STAFF_block", SWK_U1, SW_U1, KIT_V0, STRIP_V1, 0, LOBBY_H, "wall_charcoal")
STF_CU = (SWK_U1 + SW_U1) / 2
box("STAFF_door", STF_CU - 0.45, STF_CU + 0.45, STRIP_V1, STRIP_V1 + 0.04, 0, 2.1, "metal_gray", collide=False)
box("STAFF_door_bar", STF_CU - 0.35, STF_CU - 0.05, STRIP_V1 + 0.04, STRIP_V1 + 0.07, 1.0, 1.05, "metal", collide=False)
box("STAFF_door_head", STF_CU - 0.53, STF_CU + 0.53, STRIP_V1, STRIP_V1 + 0.06, 2.1, 2.18, "steel_dark", collide=False)
for nm, a in (("l", STF_CU - 0.53), ("r", STF_CU + 0.45)):
    box(f"STAFF_door_jamb_{nm}", a, a + 0.08, STRIP_V1, STRIP_V1 + 0.06, 0, 2.18, "steel_dark", collide=False)
# 4관 출구 통로 (남쪽): 스크린 옆 출구 문 → 4관 남쪽 벽을 따라 서쪽 (매점 뒤) → 서쪽 출구 통로로
XS_U1 = XD_U1 + 0.35
box("XS_floor", XP_U1, XS_U1, AUD_V1, XS_V1, -0.2, 0.0, "floor_dark", floor=True, collide=False)
box("XS_ceiling", XP_U1, XS_U1, STRIP_V0, XS_V1, 2.45, 2.55, "wall_white", collide=False)
box("XS_wall_s", AUD_U0, XS_U1, XS_V1, KIT_V0, 0, LOBBY_H, "wall_beige")                 # 매점 주방과의 칸막이
box("XS_fill_e", XS_U1, SW_U1, STRIP_V0, KIT_V0, 0, LOBBY_H, "wall_charcoal")           # 통로 동쪽 끝 ~ 띠 동쪽 면
box("XS_clad_s", XP_U0, XS_U1, XS_V1 - 0.02, XS_V1, 0, 2.45, "wall_beige", collide=False)
box("XS_wains_s", XP_U0, XS_U1, XS_V1 - 0.04, XS_V1 - 0.02, 0, 0.95, "wood", collide=False)
box("XS_clad_e", XS_U1 - 0.02, XS_U1, STRIP_V0, XS_V1, 0, 2.45, "wall_beige", collide=False)
for nm, a, b in (("w", XP_U1, XD_U0), ("e", XD_U1, XS_U1)):                                # 4관 벽 쪽 마감 (출구 문 개구부 제외)
    box(f"XS_clad_n{nm}", a, b, STRIP_V0, STRIP_V0 + 0.02, 0, 2.45, "wall_beige", collide=False)
    box(f"XS_wains_n{nm}", a, b, STRIP_V0 + 0.02, STRIP_V0 + 0.04, 0, 0.95, "wood", collide=False)
box("XS_clad_nh", XD_U0, XD_U1, STRIP_V0, STRIP_V0 + 0.02, XD_H, 2.45, "wall_beige", collide=False)
box("XS_door", XD_U0 - 1.25, XD_U0, STRIP_V0 + 0.04, STRIP_V0 + 0.08, 0, XD_H - 0.05, "metal_gray", collide=False)   # 밖으로 열린 출구 문짝
plane("SIGN_exit_xs_w", XP_U1 + 0.8, (STRIP_V0 + XS_V1) / 2, 2.2, 0.6, 0.3, "E", "sign_exit", offset=0.0, merge=True)   # 서쪽 끝에서 오른쪽(북쪽)으로
for i in range(5):
    light(f"LIGHT_xs_{i}", XP_U1 + 1.5 + i * (XS_U1 - XP_U1 - 3.0) / 4, (STRIP_V0 + XS_V1) / 2, 2.35, intensity=2.0, distance=4.5, color=(1, 0.9, 0.75))
# 줄서기 스탠션 (분홍 벨트, 카운터 가운데 앞)
STN_U0 = SC_MID - 2.4
STN_ROWS = [(STRIP_V1 + 1.2, [STN_U0, STN_U0 + 1.6, STN_U0 + 3.2, STN_U0 + 4.8]), (STRIP_V1 + 2.4, [STN_U0, STN_U0 + 1.6, STN_U0 + 3.2])]
for r, (vv, us) in enumerate(STN_ROWS):
    for i, uu in enumerate(us):
        cylinder(f"STN_{r}_{i}", uu, vv, 0, 0.95, 0.035, "metal", seg=8)
        cylinder(f"STN_base_{r}_{i}", uu, vv, 0, 0.03, 0.17, "metal", seg=12)
        if i:
            box(f"STN_belt_{r}_{i}", us[i - 1], uu, vv - 0.02, vv + 0.02, 0.86, 0.92, "belt_pink", collide=False)
box("STN_belt_link", STN_U0 - 0.02, STN_U0 + 0.02, STN_ROWS[0][0], STN_ROWS[1][0], 0.86, 0.92, "belt_pink", collide=False)

# ---------------------------------------------------------------- 박스오피스 · 인형뽑기 · ATM · 키오스크 (6관 알코브 남쪽 블록)
BO_U0, BO_U1, BO_V0, BO_V1 = U(385), U(570), V(395), V(650)
BO_MID = V(497)                  # 북쪽: 박스오피스 / 남쪽: 기기 줄
BO_BACK = BO_U0 + 2.75           # 박스오피스 직원 공간 뒷벽
KW_U = BO_U0 + 0.6               # 기기 줄 뒷벽 면
wall("BO_n", BO_U0, BO_V0, BO_U1, BO_V0, 0, LOBBY_H, "wall_stone")
wall("BO_s", BO_U0, BO_V1, BO_U1, BO_V1, 0, LOBBY_H, "wall_stone")
wall("BO_e", BO_U1, BO_V0, BO_U1, BO_V1, 0, LOBBY_H, "wall_stone")
# 박스오피스 카운터 + 유리 창구 + 직원 공간
box("BO_counter", BO_U0, BO_U0 + 0.7, BO_V0 + 0.15, BO_MID, 0, 1.05, "wall_charcoal", top_mat="black_plastic")
box("BO_counter_glow", BO_U0 - 0.01, BO_U0, BO_V0 + 0.15, BO_MID, 0.9, 0.98, "emit_warm", collide=False)
box("BO_block", BO_U0, BO_U0 + 0.1, BO_V0 + 0.15, BO_MID, 0, 3.0, "invisible", props={"invisible": 1})
box("BO_glass", BO_U0 + 0.3, BO_U0 + 0.33, BO_V0 + 0.15, BO_MID, 1.05, 2.2, "glass", collide=False)
box("BO_floor", BO_U0, BO_BACK, BO_V0, BO_MID, -0.2, 0.0, "floor_dark", collide=False)
box("BO_back", BO_BACK, BO_BACK + 0.3, BO_V0, BO_MID, 0, 3.0, "wall_charcoal")
box("BO_div", KW_U, BO_BACK + 0.3, BO_MID - 0.15, BO_MID + 0.15, 0, LOBBY_H, "wall_charcoal")
for i in range(3):
    vv = BO_V0 + 1.0 + i * 2.4
    box(f"BO_pos_{i}", BO_U0 + 0.35, BO_U0 + 0.45, vv - 0.2, vv + 0.2, 1.05, 1.4, "black_plastic", collide=False)
plane("BO_group_sign", BO_BACK, (BO_V0 + BO_MID) / 2, 2.4, 2.4, 0.6, "W", "sign_group", offset=0.01, merge=False)
for i, vv in enumerate([BO_V0 + 1.6, BO_MID - 1.6]):
    poster_box(f"P_bo_{i}", BO_BACK, vv, 1.45, "W", 4 + i, w=0.9, h=1.3)
box("BO_soffit", BO_U0 - 0.2, BO_BACK + 0.3, BO_V0, BO_MID, 3.0, LOBBY_H, "wall_charcoal", collide=False)
plane("BO_sign", BO_U0 - 0.2, (BO_V0 + BO_MID) / 2, 3.75, 3.6, 0.7, "W", "sign_boxoffice", offset=0.02, merge=False)
# 인형뽑기 3대 (박스오피스 앞 북쪽)
for i in range(3):
    v0 = BO_V0 + 0.4 + i * 0.9
    body = "claw_pink" if i == 2 else "kiosk_body"
    box(f"CL_base_{i}", BO_U0 - 0.9, BO_U0 - 0.05, v0, v0 + 0.85, 0, 0.9, body)
    box(f"CL_glass_{i}", BO_U0 - 0.88, BO_U0 - 0.07, v0 + 0.02, v0 + 0.83, 0.9, 1.9, "glass", collide=False)
    plane(f"CL_inside_{i}", BO_U0 - 0.1, v0 + 0.425, 1.4, 0.8, 1.0, "W", "kiosk_atlas", offset=0.0, merge=True, uv=(0.5, 0.0, 0.75, 0.75))
    box(f"CL_top_{i}", BO_U0 - 0.9, BO_U0 - 0.05, v0, v0 + 0.85, 1.9, 2.1, body, collide=False)
    box(f"CL_top_glow_{i}", BO_U0 - 0.91, BO_U0 - 0.9, v0 + 0.05, v0 + 0.8, 1.95, 2.05, "emit_purple", collide=False)
# 기기 줄 뒷벽 + ATM + 티켓·콤보/바로픽업 키오스크 + 위 광고 화면
box("KW_wall", KW_U, KW_U + 0.3, BO_MID, BO_V1, 0, LOBBY_H, "wall_charcoal")
box("ATM_body", KW_U - 0.6, KW_U, BO_MID + 0.4, BO_MID + 1.1, 0, 1.55, "kiosk_body")
plane("ATM_face", KW_U - 0.6, BO_MID + 0.75, 0.775, 0.7, 1.4, "W", "kiosk_atlas", offset=0.005, merge=True, uv=(0.75, 0, 1, 1))
KI_TYPES = [0, 0, 1, 0, 0]
for i, t in enumerate(KI_TYPES):
    v0 = BO_MID + 1.6 + i * 1.4
    box(f"KI_body_{i}", KW_U - 0.7, KW_U, v0, v0 + 0.95, 0, 2.0, "claw_pink" if t else "black_plastic")
    plane(f"KI_face_{i}", KW_U - 0.7, v0 + 0.475, 1.0, 0.95, 1.9, "W", "kiosk_atlas", offset=0.005, merge=True, uv=(t / 4, 0, (t + 1) / 4, 1))
    box(f"KI_side_{i}", KW_U - 0.8, KW_U, v0 + 1.1, v0 + 1.18, 0, 2.1, "kiosk_body")
for i in range(3):
    vc = BO_MID + 1.9 + i * 3.0
    box(f"AD_frame_{i}", KW_U - 0.12, KW_U, vc - 1.48, vc + 1.48, 2.75, 4.35, "black_plastic", collide=False)
    plane(f"AD_screen_{i}", KW_U - 0.12, vc, 3.55, 2.8, 1.575, "W", "ad_screens", offset=0.005, merge=True, uv=(i / 3, 0, (i + 1) / 3, 1))
# 디지털 사이니지 기둥 (매점 메뉴)
SG_U, SG_V = BO_U0 - 4.0, V(450)
box("SG_body", SG_U - 0.3, SG_U + 0.3, SG_V - 0.35, SG_V + 0.35, 0, 2.2, "black_plastic")
plane("SG_scr", SG_U - 0.3, SG_V, 1.3, 0.62, 0.89, "W", "posters", offset=0.005, merge=True, uv=poster_uv(4))
plane("SG_scr2", SG_U + 0.3, SG_V, 1.3, 0.62, 0.89, "E", "posters", offset=0.005, merge=True, uv=poster_uv(5))
light("LIGHT_box_in", (BO_U0 + BO_BACK) / 2, (BO_V0 + BO_MID) / 2, 2.6, intensity=2.0, distance=5.0, color=(1, 0.92, 0.85))

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
plane("SIGN_wc", (U(478) + U(503)) / 2, WC_V0 - 0.16, 2.75, 2.2, 0.35, "N", "sign_wc", offset=0.0, merge=True)
box("WC_hydrant", U(420), U(445), WC_V0 - 0.35, WC_V0 - 0.15, 0.6, 1.8, "red_box")
plane("WC_hydrant_label", U(432.5), WC_V0 - 0.35, 1.55, 1.6, 0.3, "N", "sign_hydrant", offset=0.005, merge=True)
for i, uu in enumerate([U(450), U(560)]):
    light(f"LIGHT_wc_{i}", uu, (WC_V0 + WC_V1) / 2, 2.75, kind="spot", angle=65, intensity=3.0, distance=6.0, color=(0.95, 0.97, 1.0))

# ---------------------------------------------------------------- 엘리베이터 홀 (남동쪽 석재 블록 안 = 10층 로비 입구)
# 서쪽 승강로에 엘리베이터 2대(동쪽을 봄), 맞은편 동쪽 벽에 LOTTE CINEMA ◁10F|4/5/6관 사인,
# 북쪽 면은 포스터 3칸 폭: 서쪽 2칸은 통째로 광고 포스터 벽, 동쪽 1칸이 로비로 나가는 입구,
# 남쪽(엘리베이터를 보면 왼쪽)은 통창 + 그 앞에 상영작 브로마이드
EL_U0, EL_U1, EL_V0, EL_V1 = U(285), U(400), V(690), V(840)
EH_U0, EH_U1 = EL_U0 + 2.4, WC_U0 - 0.15       # 홀 안쪽: 승강로 앞면 ~ 화장실 서벽 안쪽 면
EH_V1, EH_H = EL_V1 - 0.3, 3.2                  # 남쪽 벽 안쪽 면, 천장 높이
EH_CV = (EL_V0 + EH_V1) / 2                     # 엘리베이터·사인 중심
EH_IN_U0 = EL_U0 + (EL_U1 - EL_U0) * 2 / 3      # 로비 쪽 입구 서쪽 끝 (그 서쪽은 광고 벽)
box("EL_block", EL_U0, EH_U0, EL_V0, EL_V1, 0, LOBBY_H, "wall_stone")                       # 승강로
box("EH_win_top", EH_U0, EL_U1, EH_V1, EL_V1, EH_H, LOBBY_H, "wall_stone", collide=False)    # 통창 위 (홀 천장 위)
box("EH_glass", EH_U0, EH_U1, EL_V1 - 0.18, EL_V1 - 0.12, 0, EH_H, "glass", collide=True)
box("EH_win_sill", EH_U0, EH_U1, EL_V1 - 0.25, EL_V1 - 0.05, 0, 0.25, "steel_dark")
box("EH_win_head", EH_U0, EH_U1, EL_V1 - 0.25, EL_V1 - 0.05, EH_H - 0.15, EH_H, "steel_dark", collide=False)
for i in range(5):
    uu = EH_U0 + 0.04 + i * (EH_U1 - EH_U0 - 0.08) / 4
    box(f"EH_mullion_{i}", uu - 0.04, uu + 0.04, EL_V1 - 0.21, EL_V1 - 0.09, 0, EH_H, "steel_dark", collide=False)
box("EH_wall_n", EH_U0, EH_IN_U0, EL_V0, EL_V0 + 0.3, 0, EH_H, "wall_stone")                  # 광고 벽 (승강로에 이어서)
box("EH_bulkhead", EH_U0, EL_U1, EL_V0, EL_V0 + 0.3, EH_H, LOBBY_H, "wall_stone", collide=False)   # 입구 위
# 로비 쪽 광고 벽: 북쪽 면 서쪽 2칸 전체를 덮는 라이트박스 (포스터 아틀라스의 파란 포스터 두 장)
AD_W = EH_IN_U0 - EL_U0 - 0.4
AD_H = AD_W * 0.75
box("EH_ad_frame", EL_U0 + 0.12, EH_IN_U0 - 0.12, EL_V0 - 0.12, EL_V0, 0.17, 0.33 + AD_H, "black_plastic", collide=False)
plane("EH_ad", (EL_U0 + EH_IN_U0) / 2, EL_V0 - 0.12, 0.25 + AD_H / 2, AD_W, AD_H, "N", "posters", offset=0.005, merge=True, uv=(0, 0, 0.5, 0.5))
box("EH_ceiling", EH_U0, EH_U1, EL_V0 + 0.3, EH_V1, EH_H, EH_H + 0.1, "ceiling_gray", collide=False)
box("EH_floor_e", U(390) + 0.15, EH_U1, EL_V0, EH_V1, -0.2, 0.0, "floor_dark", floor=True, collide=False)   # 로비 바닥이 닿지 않는 동쪽 끝
box("EH_clad_e", EH_U1 - 0.02, EH_U1, EL_V0, EH_V1, 0, EH_H, "wall_stone", collide=False)   # 화장실 흰 벽 위 석재 마감
for i, vc in enumerate([EH_CV - 1.5, EH_CV + 1.5]):
    box(f"EV_door_{i}", EH_U0, EH_U0 + 0.04, vc - 0.55, vc + 0.55, 0, 2.2, "metal", collide=False)
    box(f"EV_seam_{i}", EH_U0 + 0.04, EH_U0 + 0.045, vc - 0.006, vc + 0.006, 0, 2.2, "black_plastic", collide=False)
    box(f"EV_jamb_l{i}", EH_U0, EH_U0 + 0.1, vc - 0.68, vc - 0.55, 0, 2.32, "steel_dark", collide=False)
    box(f"EV_jamb_r{i}", EH_U0, EH_U0 + 0.1, vc + 0.55, vc + 0.68, 0, 2.32, "steel_dark", collide=False)
    box(f"EV_head_{i}", EH_U0, EH_U0 + 0.1, vc - 0.68, vc + 0.68, 2.2, 2.32, "steel_dark", collide=False)
    box(f"EV_ind_{i}", EH_U0, EH_U0 + 0.04, vc - 0.25, vc + 0.25, 2.45, 2.65, "black_plastic", collide=False)
    box(f"EV_ind_lit_{i}", EH_U0 + 0.04, EH_U0 + 0.045, vc - 0.12, vc + 0.12, 2.5, 2.6, "emit_warm", collide=False)
    box(f"EV_sill_{i}", EH_U0, EH_U0 + 0.25, vc - 0.55, vc + 0.55, 0, 0.01, "metal", collide=False)
# 호출 버튼 (두 엘리베이터 사이)
box("EV_call", EH_U0, EH_U0 + 0.03, EH_CV - 0.06, EH_CV + 0.06, 1.0, 1.28, "metal", collide=False)
box("EV_call_up", EH_U0 + 0.03, EH_U0 + 0.035, EH_CV - 0.03, EH_CV + 0.03, 1.17, 1.22, "emit_white", collide=False)
box("EV_call_dn", EH_U0 + 0.03, EH_U0 + 0.035, EH_CV - 0.03, EH_CV + 0.03, 1.06, 1.11, "emit_white", collide=False)
# 엘리베이터에서 내리면 바로 보이는 맞은편 사인 (◁ = 왼쪽(북쪽) 로비 입구)
plane("SIGN_lotte_el", EH_U1, EH_CV, 2.05, 4.8, 1.2, "W", "sign_lotte", offset=0.03, merge=False)
# 통창 앞 상영작 브로마이드 (입간판, 홀 안쪽을 봄)
BR_CU, BR_V = (EH_U0 + EH_U1) / 2, EL_V1 - 1.1
box("EH_bromide_base", BR_CU - 0.7, BR_CU + 0.7, BR_V - 0.13, BR_V + 0.17, 0, 0.08, "black_plastic")
box("EH_bromide_board", BR_CU - 0.65, BR_CU + 0.65, BR_V, BR_V + 0.04, 0.08, 1.94, "black_plastic")
plane("EH_bromide", BR_CU, BR_V, 1.01, 1.28, 1.84, "N", "posters", offset=0.005, merge=True, uv=poster_uv(2))   # 절찬상영중
for i, vv in enumerate([EL_V0 + 2.6, EH_V1 - 2.6]):
    cylinder(f"DL_eh_{i}", (EH_U0 + EH_U1) / 2, vv, EH_H - 0.02, EH_H, 0.1, "emit_white", seg=10)
    light(f"LIGHT_eh_{i}", (EH_U0 + EH_U1) / 2, vv, EH_H - 0.05, kind="spot", angle=65, intensity=6.0, distance=7.0, color=(1, 0.92, 0.82))
# 접속 시작 위치: 엘리베이터 앞, 맞은편 사인(동쪽)을 바라봄. yaw = atan2(dx, dz) 기준
empty("SPAWN", EH_U0 + 2.0, EH_CV, 0.0, {"spawn": 1, "yaw": math.pi / 2})
# 남쪽 외벽 동쪽 연결
wall("W_south_e", U(290), SOUTH_V, U(290), EL_V1, 0, LOBBY_H, "wall_stone")
wall("W_south_e2", U(290), EL_V1, EL_U0, EL_V1, 0, LOBBY_H, "wall_stone")

# ---------------------------------------------------------------- 에어컨장 (남쪽 벽: 루버 도어 안에 스탠드형 에어컨)
AC_CU = (AC_U0 + AC_U1) / 2
AC_IN = SOUTH_V + 0.3          # 남쪽 벽 바깥 면 = 수납장 안쪽 시작
for nm, a, b, c, d in (("back", AC_U0 - 0.15, AC_U1 + 0.15, AC_IN + 1.0, AC_IN + 1.15),
                       ("l", AC_U0 - 0.15, AC_U0, AC_IN, AC_IN + 1.0), ("r", AC_U1, AC_U1 + 0.15, AC_IN, AC_IN + 1.0)):
    box(f"AC_wall_{nm}", a, b, c, d, 0, AC_TOP, "wall_charcoal", collide=False)
box("AC_ceil", AC_U0 - 0.15, AC_U1 + 0.15, AC_IN, AC_IN + 1.15, AC_TOP, AC_TOP + 0.1, "wall_charcoal", collide=False)
box("AC_floor", AC_U0, AC_U1, SOUTH_V, AC_IN + 1.0, -0.2, 0.0, "floor_dark", collide=False)
box("AC_unit", AC_CU - 0.29, AC_CU + 0.29, AC_IN + 0.25, AC_IN + 0.62, 0, 1.85, "kiosk_body", collide=False)
box("AC_unit_grille", AC_CU - 0.24, AC_CU + 0.24, AC_IN + 0.24, AC_IN + 0.25, 1.15, 1.7, "black_plastic", collide=False)
box("AC_unit_disp", AC_CU - 0.08, AC_CU + 0.08, AC_IN + 0.235, AC_IN + 0.24, 0.95, 1.05, "emit_blue", collide=False)
# 루버 도어 (위·아래 두 칸)
for nm, a, b, z0, z1 in (("jl", AC_U0, AC_U0 + 0.07, 0, AC_TOP), ("jr", AC_U1 - 0.07, AC_U1, 0, AC_TOP),
                         ("head", AC_U0, AC_U1, AC_TOP - 0.08, AC_TOP), ("mid", AC_U0, AC_U1, 1.12, 1.2), ("bot", AC_U0, AC_U1, 0, 0.12)):
    box(f"AC_frame_{nm}", a, b, SOUTH_V - 0.03, SOUTH_V + 0.06, z0, z1, "metal_gray")
for k, (z0, z1) in enumerate(((0.16, 1.08), (1.24, AC_TOP - 0.12))):
    n = int((z1 - z0) / 0.07)
    for j in range(n):
        zz = z0 + j * (z1 - z0) / n
        box(f"AC_slat_{k}_{j}", AC_U0 + 0.07, AC_U1 - 0.07, SOUTH_V, SOUTH_V + 0.05, zz, zz + 0.035, "metal_gray")

# ---------------------------------------------------------------- 하행 에스컬레이터 & 보이드 (탑승 지점까지만, 진입 불가)
TAN30 = math.tan(math.radians(30))


def es_z(v):
    """에스컬레이터 스텝 라인 높이 (상부 평지 → 30° 경사 → 하부 평지)"""
    return -min(max(v - ES_INC0, 0.0), ES_INC1 - ES_INC0) * TAN30


def es_band(name, u0, u1, lo, hi, mat, v0, v1, collide=False):
    """스텝 라인에서 lo~hi 만큼 떨어져 따라가는 띠 (평지/경사/평지 3토막)"""
    for k, (a, b) in enumerate(((v0, ES_INC0), (ES_INC0, ES_INC1), (ES_INC1, v1))):
        if b - a > 1e-3:
            prism_vz(f"{name}_{k}", u0, u1, [(a, es_z(a) + lo), (b, es_z(b) + lo), (b, es_z(b) + hi), (a, es_z(a) + hi)],
                     mat, collide=collide)


prism_vz("ES_truss", ES_U0, ES_U1, [(ES_INC0, -0.3), (ES_INC1, -ES_DROP - 0.3), (ES_INC1, -ES_DROP - 1.2), (ES_INC0, -1.2)], "steel_dark")
for side, sgn, edge in (("w", 1, ES_U0), ("e", -1, ES_U1)):
    def span(a, b):
        return (edge + sgn * a, edge + sgn * b) if sgn > 0 else (edge + sgn * b, edge + sgn * a)
    es_band(f"ES_clad_{side}", *span(0.0, 0.1), -1.15, 0.12, "metal", ES_V0 - 0.8, ES_V1 + 0.8)            # 바깥 마감
    es_band(f"ES_deck_{side}", *span(0.1, ES_CU - 0.52 - ES_U0), -0.3, 0.1, "metal", ES_V0 - 0.8, ES_V1 + 0.8)  # 데크/스커트
    es_band(f"ES_glass_{side}", *span(0.2, 0.23), 0.1, 0.95, "glass", ES_V0 - 0.5, ES_V1 + 0.5, collide=True)
    es_band(f"ES_rail_{side}", *span(0.17, 0.26), 0.95, 1.03, "black_plastic", ES_V0 - 0.8, ES_V1 + 0.8)
    es_band(f"ES_skirtled_{side}", *span(ES_CU - 0.52 - ES_U0, ES_CU - 0.515 - ES_U0), 0.03, 0.07, "emit_step", ES_V0, ES_V1)
    a, b = span(0.17, 0.26)
    box(f"ES_newel_t{side}", a, b, ES_V0 - 0.8, ES_V0 - 0.65, 0.1, 1.03, "black_plastic")
    box(f"ES_newel_b{side}", a, b, ES_V1 + 0.65, ES_V1 + 0.8, -ES_DROP + 0.1, -ES_DROP + 1.03, "black_plastic", collide=False)
# 스텝 (노란 경계선)
i, v = 0, ES_V0
while v < ES_V1 - 0.01:
    top = es_z(v + 0.4) + 0.012
    box(f"ES_step_{i}", ES_CU - 0.5, ES_CU + 0.5, v, v + 0.39, top - 0.3, top, "steel_dark", collide=False)
    box(f"ES_step_y{i}", ES_CU - 0.5, ES_CU + 0.5, v, v + 0.05, top, top + 0.004, "esc_yellow", collide=False)
    v += 0.4
    i += 1
box("ES_comb_t", ES_U0 + 0.1, ES_U1 - 0.1, ES_V0 - 1.0, ES_V0, 0, 0.012, "metal", collide=False)
box("ES_comb_ty", ES_CU - 0.5, ES_CU + 0.5, ES_V0 - 0.06, ES_V0, 0.012, 0.016, "esc_yellow", collide=False)
box("ES_comb_b", ES_U0 + 0.1, ES_U1 - 0.1, ES_V1, ES_V1 + 1.0, -ES_DROP, -ES_DROP + 0.012, "metal", collide=False)
box("ES_block", ES_U0 + 0.1, ES_U1 - 0.1, ES_V0 + 0.3, ES_V0 + 0.4, 0, 2.5, "invisible", props={"invisible": 1})


def balustrade(name, u0, u1, v0, v1, h=1.1, frame="metal"):
    """보이드 가장자리 유리 난간 (점프로 넘지 못하게 투명 충돌벽 포함)"""
    box(name + "_curb", u0, u1, v0, v1, 0, 0.1, "steel_dark")
    box(name + "_glass", u0, u1, v0, v1, 0.1, h, "glass")
    box(name + "_cap", u0 - 0.01, u1 + 0.01, v0 - 0.01, v1 + 0.01, h, h + 0.05, frame, collide=False)
    box(name + "_block", u0, u1, v0, v1, 0, 2.6, "invisible", props={"invisible": 1})


balustrade("VB_w", VOID_U0 - 0.08, VOID_U0, V(545), VOID_V1 + 0.08)
balustrade("VB_s", VOID_U0, VOID_U1, VOID_V1, VOID_V1 + 0.08)
balustrade("VB_n", ES_U1, VOID_U1, VOID_V0 - 0.08, VOID_V0, h=2.2, frame="bronze")
for k in range(1, 3):
    uu = ES_U1 + k * (VOID_U1 - ES_U1) / 3
    box(f"VB_n_mullion_{k}", uu - 0.03, uu + 0.03, VOID_V0 - 0.09, VOID_V0 + 0.01, 0.1, 2.2, "bronze", collide=False)
box("VB_e_block", VOID_U1, VOID_U1 + 0.05, VOID_V0, VOID_V1, 0, 2.6, "invisible", props={"invisible": 1})

# 보이드 아래층 (내려다보이는 부분만)
PIT_U0, PIT_U1, PIT_V0, PIT_V1 = VOID_U0 - 1.5, VOID_U1 + 1.5, ES_V0 - 1.5, VOID_V1 + 1.5
box("PIT_floor", PIT_U0, PIT_U1, PIT_V0, PIT_V1, -ES_DROP - 0.2, -ES_DROP, "floor_dark", collide=False)
for nm, a, b, c, d in (("w", PIT_U0 - 0.2, PIT_U0, PIT_V0, PIT_V1), ("e", PIT_U1, PIT_U1 + 0.2, PIT_V0, PIT_V1),
                       ("n", PIT_U0, PIT_U1, PIT_V0 - 0.2, PIT_V0), ("s", PIT_U0, PIT_U1, PIT_V1, PIT_V1 + 0.2)):
    box(f"PIT_wall_{nm}", a, b, c, d, -ES_DROP, -0.2, "wall_stone", collide=False)
for nm, a, b, c, d in (("w", PIT_U0, VOID_U0, PIT_V0, PIT_V1), ("e", VOID_U1, PIT_U1, PIT_V0, PIT_V1),
                       ("n", VOID_U0, VOID_U1, PIT_V0, VOID_V0), ("s", VOID_U0, VOID_U1, VOID_V1, PIT_V1)):
    box(f"PIT_soffit_{nm}", a, b, c, d, -0.8, -0.2, "ceiling_gray", collide=False)
poster_box("P_pit_0", ES_CU + 1.8, PIT_V1, -ES_DROP + 1.75, "N", 2)
poster_box("P_pit_1", ES_CU + 3.6, PIT_V1, -ES_DROP + 1.75, "N", 0)
poster_box("P_pit_2", PIT_U1, VOID_V1 - 3.0, -ES_DROP + 1.75, "W", 1)
light("LIGHT_pit_0", ES_CU + 1.6, VOID_V0 + 6.0, -ES_DROP + 3.5, intensity=5.0, distance=12.0, color=(1, 0.9, 0.8))
light("LIGHT_pit_1", ES_CU + 1.6, VOID_V1 - 3.0, -ES_DROP + 3.5, intensity=5.0, distance=12.0, color=(1, 0.9, 0.8))

# ---------------------------------------------------------------- 창가 바 & 맞은편 바 테이블 & 로비 전광판
# 창가 바 카운터 (창을 보고 앉음)
box("BAR_window", W_GLASS_U + 0.1, W_GLASS_U + 0.7, V(548), SOUTH_V - 0.4, 1.0, 1.06, "wood", collide=False)
box("BAR_window_leg", W_GLASS_U + 0.1, W_GLASS_U + 0.2, V(548), SOUTH_V - 0.4, 0, 1.0, "wood")
# 에스컬레이터 탑승구 옆 브론즈 기둥 + '내려가는 곳 10F' 사인
box("BAR_pillar", 0.0, VOID_U0, V(510), V(545), 0, LOBBY_H, "bronze")
plane("SIGN_down_n", VOID_U0 - 0.65, V(510), 1.95, 0.55, 1.1, "N", "sign_down", offset=0.01, merge=True)
plane("SIGN_down_e", VOID_U0, V(538), 1.95, 0.55, 1.1, "E", "sign_down", offset=0.01, merge=True)
BCOL_V0, BCOL_V1 = V(707), V(732)
box("BAR_col", W_GLASS_U + 1.38, VOID_U0 - 0.1, BCOL_V0, BCOL_V1, 0, LOBBY_H, "wall_stone")


def stool(name, cu, cv):
    cylinder(name + "_seat", cu, cv, 0.72, 0.76, 0.18, "black_plastic", seg=12)
    for dx, dy in ((-0.13, -0.13), (0.13, -0.13), (0.13, 0.13), (-0.13, 0.13)):
        box(name + f"_leg{dx}{dy}", cu + dx - 0.015, cu + dx + 0.015, cv + dy - 0.015, cv + dy + 0.015, 0, 0.72, "black_plastic", collide=False)


for i in range(24):
    vv = V(560) + i * 1.1
    if vv > SOUTH_V - 0.8:
        break
    if BCOL_V0 - 0.4 < vv < BCOL_V1 + 0.4:
        continue
    stool(f"ST_w{i}", W_GLASS_U + 0.95, vv)
# 맞은편 바 테이블: 보이드 쪽(서쪽)을 보고 앉는 한쪽 바, 상판 뒤에 유리 난간
OT_V0, OT_V1 = V(520), VOID_V1
box("OT_base", VOID_U1, VOID_U1 + 0.5, OT_V0, OT_V1, 0, 1.0, "wood")
box("OT_top", VOID_U1, VOID_U1 + 0.72, OT_V0, OT_V1, 1.0, 1.06, "wood", collide=False)
box("OT_glass", VOID_U1, VOID_U1 + 0.03, OT_V0, OT_V1, 1.06, 1.55, "glass")
box("OT_glass_cap", VOID_U1 - 0.01, VOID_U1 + 0.04, OT_V0, OT_V1, 1.55, 1.58, "metal", collide=False)
box("OT_footrail", VOID_U1 + 0.5, VOID_U1 + 0.53, OT_V0, OT_V1, 0.18, 0.22, "metal", collide=False)
for i in range(30):
    vv = OT_V0 + 0.6 + i * 1.0
    if vv > OT_V1 - 0.4:
        break
    stool(f"ST_o{i}", VOID_U1 + 1.05, vv)
# 로비 전광판 (남쪽 벽 높이, 에어컨장과 맞은편 바 테이블 사이)
LED_W, LED_H, LED_Z0 = 3.2, 1.8, 2.75
LED_CU = 11.0
box("LED_frame", LED_CU - LED_W / 2 - 0.1, LED_CU + LED_W / 2 + 0.1, SOUTH_V - 0.12, SOUTH_V, LED_Z0 - 0.1, LED_Z0 + LED_H + 0.1, "black_plastic", collide=False)
plane("LED_LOBBY", LED_CU, SOUTH_V - 0.12, LED_Z0 + LED_H / 2, LED_W, LED_H, "N", "led_black", offset=0.01,
      props={"display": "lobby", "w": LED_W, "h": LED_H})
# 스탠디 (포스터 입간판, 전광판 아래 에어컨장 옆)
STD_CU = AC_U0 - 0.75
box("STANDEE_base", STD_CU - 0.7, STD_CU + 0.7, SOUTH_V - 1.25, SOUTH_V - 0.95, 0, 0.08, "black_plastic")
box("STANDEE_board", STD_CU - 0.65, STD_CU + 0.65, SOUTH_V - 1.12, SOUTH_V - 1.08, 0.08, 1.94, "black_plastic")
plane("STANDEE", STD_CU, SOUTH_V - 1.12, 1.01, 1.28, 1.84, "N", "posters", offset=0.005, merge=True, uv=poster_uv(6))
# 승강로 서쪽 면 (남쪽 로비 동벽, 포스터 벽)
for i, cv in enumerate([54.6, 56.4, 58.2]):
    poster_box(f"P_el_w{i}", EL_U0, cv, 1.75, "W", 5 + i)

# ---------------------------------------------------------------- 로비 소품
# 대기 벤치
for i in range(3):
    box(f"BENCH_{i}", U(200) + i * 3.2, U(200) + i * 3.2 + 2.2, V(440), V(452), 0, 0.45, "wood", top_mat="wood")
# 천장 다운라이트 (발광 원판, 로비 전체 3.6m 격자) + 그 자리에서 아래로 비추는 스포트 조명
# 조명은 다운라이트 한 칸 건너 하나씩(7.2m 간격). 천장 바로 아래 포인트 조명처럼 천장이 하얗게 뜨지 않고 바닥에 빛이 고인다
DL_SKIP = [(EL_U0 - 0.3, EL_U1, EL_V0 - 0.3, EL_V1)]      # 석재 블록 위
DL_SPOT_EXTRA = {(3, 9), (1, 5), (1, 8)}                   # 남쪽 로비 동쪽, 보이드 위 코퍼
for i in range(6):
    for j in range(11):
        cu = 1.5 + i * 3.6
        cv = V(355) + j * 3.6
        if cu > U(380) or cv > SOUTH_V - 1 or any(a <= cu <= b and c <= cv <= d for a, b, c, d in DL_SKIP):
            continue
        zc = CF_H if CF_U0 < cu < CF_U1 and CF_V0 < cv < CF_V1 else LOBBY_H
        cylinder(f"DL_{i}_{j}", cu, cv, zc - 0.02, zc, 0.1, "emit_white", seg=10)
        if (i % 2 == 0 and j % 2 == 0) or (i, j) in DL_SPOT_EXTRA:
            light(f"LIGHT_lobby_{i}_{j}", cu, cv, zc - 0.05, kind="spot", angle=60, penumbra=0.55,
                  intensity=13.0, distance=11.0 + (zc - LOBBY_H), color=(1, 0.92, 0.82))
for (cu, cv) in [(U(410), V(300)), (U(500), V(300)), (U(500), V(370)), (U(410), V(370)), (U(450), V(665)), (U(560), V(665))]:
    cylinder(f"DL_e_{cu:.0f}_{cv:.0f}", cu, cv, LOBBY_H - 0.02, LOBBY_H, 0.1, "emit_white", seg=10)
    light(f"LIGHT_e_{cu:.0f}_{cv:.0f}", cu, cv, LOBBY_H - 0.05, kind="spot", angle=60, penumbra=0.55, intensity=13.0, distance=11.0, color=(1, 0.92, 0.82))
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
    # 미리보기 전용: LIGHT_ 엠프티 → 실제 라이트 (spot은 아래를 향함: Blender 스포트 기본 방향이 -Z)
    for o in list(COL.objects):
        if o.type == "EMPTY" and "light" in o.keys():
            spot = o["light"] == "spot"
            ld = bpy.data.lights.new(o.name + "_L", "SPOT" if spot else "POINT")
            ld.color = tuple(o["color"])[:3]
            ld.energy = float(o["intensity"]) * (120 if spot else 60)
            ld.shadow_soft_size = 0.3
            if spot:
                ld.spot_size = math.radians(float(o.get("angle", 55))) * 2
                ld.spot_blend = float(o.get("penumbra", 0.6))
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
        "elevator_hall": ((EH_U1 - 0.6, -EH_CV, 1.6), (math.radians(88), 0, math.radians(90)), 75, False),
        "elevator_sign": ((EH_U0 + 0.5, -EH_CV, 1.6), (math.radians(88), 0, math.radians(-90)), 75, False),
        "elevator_window": ((EH_U0 + 3.0, -(EL_V0 + 1.0), 1.6), (math.radians(86), 0, math.radians(180)), 75, False),
        "elevator_entrance": ((EH_IN_U0 - 1.5, -(EL_V0 - 8.0), 1.6), (math.radians(88), 0, math.radians(180)), 70, False),
        "exit4_westcor": ((1.5, -(V(45) + 7.0), 1.6), (math.radians(88), 0, math.radians(-18)), 70, False),
        "theater_exit_s": ((AUD_U1 - 3.5, -(AUD_V1 - 5.0), 1.6), (math.radians(88), 0, math.radians(-158)), 70, False),
        "exit_passage_w": (((XP_U0 + XP_U1) / 2, -(AUD_V1 - 1.0), 1.6), (math.radians(88), 0, 0), 75, False),
        "escalator": ((ES_CU + 1.6, -(ES_V0 - 5.0), 2.2), (math.radians(72), 0, math.radians(180)), 75, False),
        "lobby_south": ((10.2, -(SOUTH_V - 8.0), 1.5), (math.radians(88), 0, math.radians(172)), 70, False),
        "lobby_north": ((10.0, -(SOUTH_V - 4.5), 1.5), (math.radians(88), 0, math.radians(14)), 70, False),
        "lobby_door4": ((U(420), -V(380), 1.7), (math.radians(90), 0, 0), 75, False),
        "entrance4": ((U(476), -V(388), 1.6), (math.radians(90), 0, math.radians(10)), 70, False),
        "entrance4_in": (((IN_U0 + IN_U1) / 2, -V(258), 1.6), (math.radians(90), 0, 0), 75, False),
        "sweet": (((SC_U0 + SC_U1) / 2 - 1.2, -(STRIP_V1 + 7.0), 1.6), (math.radians(88), 0, math.radians(8)), 75, False),
        "box_office": ((BO_U0 - 7.0, -(BO_V0 + 7.5), 1.6), (math.radians(88), 0, math.radians(-90)), 75, False),
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
