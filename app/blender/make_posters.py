# 사이버 홍대입구 - 기본 영화 포스터 8장 (오리지널 가상 영화, PIL로 그림)
# 사용: python make_posters.py
#   → ../client/assets/posters/poster_1..8.jpg  (700x1000, 서버 기본 포스터 / 로비 전광판 슬라이드)
#   → ./textures/posters.jpg                    (4x2 아틀라스, 슬롯 512x768, 맵 GLB에 굽는 기본값)
# 관리자 대시보드의 '포스터' 탭에서 칸마다 다른 이미지로 바꿀 수 있다.
import math
import os
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_CLIENT = os.path.normpath(os.path.join(HERE, "..", "client", "assets", "posters"))
OUT_ATLAS = os.path.join(HERE, "textures", "posters.jpg")
FONTS = "C:/Windows/Fonts/"
W, H = 1400, 2000          # 2배로 그린 뒤 700x1000으로 줄여 계단 현상을 없앤다


def F(names, size, variation=None):
    for n in ([names] if isinstance(names, str) else names) + ["malgunbd.ttf"]:
        try:
            f = ImageFont.truetype(FONTS + n, size)
            if variation:
                try:
                    f.set_variation_by_name(variation)
                except Exception:
                    pass
            return f
        except OSError:
            continue
    raise SystemExit("글꼴을 찾을 수 없습니다")


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def grad(stops):
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / (H - 1)
        for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
            if t0 <= t <= t1:
                d.line([0, y, W, y], fill=mix(c0, c1, (t - t0) / max(1e-6, t1 - t0)))
                break
    return img


def layer():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def comp(base, lay, blur=0):
    if blur:
        lay = lay.filter(ImageFilter.GaussianBlur(blur))
    return Image.alpha_composite(base.convert("RGBA"), lay).convert("RGB")


def screen(base, lay_rgb, blur=0):
    if blur:
        lay_rgb = lay_rgb.filter(ImageFilter.GaussianBlur(blur))
    return ImageChops.screen(base.convert("RGB"), lay_rgb)


def glow(base, xy, r, color, blur=None, ellipse=None):
    lay = Image.new("RGB", (W, H), 0)
    x, y = xy
    rx, ry = ellipse or (r, r)
    ImageDraw.Draw(lay).ellipse([x - rx, y - ry, x + rx, y + ry], fill=color)
    return screen(base, lay, blur if blur is not None else r * 0.6)


def grain(img, amount=10, seed=0):
    n = Image.effect_noise((W // 2, H // 2), 64).resize((W, H)).convert("RGB")
    return Image.blend(img, ImageChops.overlay(img, n), amount / 100)


def vignette(img, strength=0.55):
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).ellipse([-W * 0.25, -H * 0.15, W * 1.25, H * 1.15], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(220))
    dark = Image.new("RGB", (W, H), 0)
    return Image.composite(img, Image.blend(img, dark, strength), m)


def bottom_fade(img, start=0.72, color=(0, 0, 0), alpha=235):
    lay = layer()
    d = ImageDraw.Draw(lay)
    y0 = int(H * start)
    for y in range(y0, H):
        t = (y - y0) / (H - y0)
        d.line([0, y, W, y], fill=color + (int(alpha * min(1, t * 1.4)),))
    return comp(img, lay)


def text_width(f, s, spacing=0):
    return sum(f.getlength(ch) for ch in s) + spacing * max(0, len(s) - 1)


def draw_text(img, y, s, f, fill, spacing=0, x=None, stroke=0, stroke_fill=(0, 0, 0), shadow=None, glow_col=None, anchor="c"):
    """한 줄 글자 (자간 지원). shadow=(dx, dy, blur, rgba), glow_col=(rgb, blur)"""
    w = text_width(f, s, spacing)
    if x is None:
        x = W / 2
    x0 = x - w / 2 if anchor == "c" else (x - w if anchor == "r" else x)

    def put(d, col, ox=0, oy=0, sw=0, sf=None):
        cx = x0 + ox
        for ch in s:
            d.text((cx, y + oy), ch, font=f, fill=col, stroke_width=sw, stroke_fill=sf)
            cx += f.getlength(ch) + spacing

    if glow_col:
        g = Image.new("RGB", (W, H), 0)
        put(ImageDraw.Draw(g), glow_col[0], sw=stroke + 6, sf=glow_col[0])
        img = screen(img, g, glow_col[1])
    if shadow:
        lay = layer()
        put(ImageDraw.Draw(lay), shadow[3], shadow[0], shadow[1], stroke, shadow[3])
        img = comp(img, lay, shadow[2])
    lay = layer()
    put(ImageDraw.Draw(lay), fill, sw=stroke, sf=stroke_fill)
    return comp(img, lay)


RATING = {"ALL": (40, 160, 70), "12": (230, 180, 20), "15": (230, 120, 30), "18": (210, 30, 40)}


def footer(img, credits, release, rating, color=(205, 205, 210), accent=(255, 255, 255)):
    """하단 크레딧 블록 + 개봉 문구 + 관람등급"""
    fc = F(["NotoSansKR-Light.ttf", "malgun.ttf"], 27)
    y = H - 250
    for line in credits:
        img = draw_text(img, y, line, fc, color + (255,), spacing=1)
        y += 40
    fr = F(["NotoSansKR-Bold.ttf", "malgunbd.ttf"], 54)
    rw = text_width(fr, release, 4)
    bx = W / 2 - rw / 2 - 90
    img = draw_text(img, H - 140, release, fr, accent + (255,), spacing=4, x=W / 2 + 30)
    lay = layer()
    d = ImageDraw.Draw(lay)
    d.ellipse([bx - 6, H - 140, bx + 70, H - 64], fill=RATING[rating] + (255,))
    fb = F(["NotoSansKR-Black.ttf", "malgunbd.ttf"], 34 if rating == "ALL" else 40)
    tw = fb.getlength(rating)
    d.text((bx + 32 - tw / 2, H - 132 + (4 if rating == "ALL" else 0)), rating, font=fb, fill=(255, 255, 255, 255))
    return comp(img, lay)


def stars(img, n, seed, y1=H, big=0.03, col=(255, 255, 255)):
    rr = random.Random(seed)
    lay = layer()
    d = ImageDraw.Draw(lay)
    for _ in range(n):
        x, y = rr.uniform(0, W), rr.uniform(0, y1) ** 1.0
        r = rr.choice([1, 1, 1.5, 2, 2.5]) if rr.random() > big else rr.uniform(3, 5)
        a = rr.randint(90, 255)
        d.ellipse([x - r, y - r, x + r, y + r], fill=col + (a,))
    return comp(img, lay)


def flare(img, xy, size, color=(255, 255, 255)):
    x, y = xy
    g = Image.new("RGB", (W, H), 0)
    d = ImageDraw.Draw(g)
    d.polygon([(x - size, y), (x, y - 5), (x + size, y), (x, y + 5)], fill=color)
    d.polygon([(x, y - size * 0.8), (x - 5, y), (x, y + size * 0.8), (x + 5, y)], fill=color)
    img = screen(img, g, 3)
    return glow(img, xy, size * 0.18, color, blur=size * 0.12)


# ---------------------------------------------------------------------- 1. 심야 정류장
def p_midnight():
    img = grad([(0, (8, 14, 38)), (0.45, (18, 52, 84)), (0.72, (12, 30, 50)), (1, (4, 8, 14))])
    img = stars(img, 160, 1, y1=H * 0.5)
    img = glow(img, (930, 560), 420, (40, 70, 100), blur=200)
    lay = layer()
    d = ImageDraw.Draw(lay)
    d.ellipse([930 - 250, 560 - 250, 930 + 250, 560 + 250], fill=(236, 238, 222, 255))
    rr = random.Random(3)
    for _ in range(14):
        cx, cy, r = 930 + rr.uniform(-170, 170), 560 + rr.uniform(-170, 170), rr.uniform(14, 46)
        if math.hypot(cx - 930, cy - 560) + r < 245:
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(205, 210, 196, 255))
    img = comp(img, lay)
    img = glow(img, (930, 560), 270, (90, 110, 120), blur=60)
    # 도시 실루엣
    lay = layer()
    d = ImageDraw.Draw(lay)
    x = -20
    rr = random.Random(7)
    while x < W:
        w = rr.randint(70, 160)
        top = rr.randint(1020, 1240)
        d.rectangle([x, top, x + w, 1600], fill=(10, 18, 30, 255))
        for wy in range(top + 20, 1560, 34):
            for wx in range(x + 12, x + w - 14, 26):
                if rr.random() < 0.18:
                    d.rectangle([wx, wy, wx + 10, wy + 14], fill=(255, 210, 140, 200))
        x += w + rr.randint(4, 18)
    img = comp(img, lay)
    # 정류장 + 가로등 + 사람
    lay = layer()
    d = ImageDraw.Draw(lay)
    K = (3, 6, 10, 255)
    d.rectangle([0, 1480, W, H], fill=K)
    d.rectangle([230, 1180, 990, 1210], fill=K)
    for px in (260, 950):
        d.rectangle([px, 1210, px + 18, 1480], fill=K)
    d.rectangle([300, 1250, 920, 1262], fill=(40, 80, 110, 255))
    d.rectangle([840, 1260, 900, 1340], fill=(255, 220, 150, 255))     # 정류장 시간표 불빛
    d.rectangle([1150, 820, 1166, 1480], fill=K)
    d.polygon([(1110, 800), (1206, 800), (1190, 830), (1126, 830)], fill=K)
    # 사람: 머리 + 코트
    d.ellipse([562, 1268, 610, 1318], fill=K)
    d.polygon([(550, 1322), (622, 1322), (650, 1480), (522, 1480)], fill=K)
    img = comp(img, lay)
    cone = Image.new("RGB", (W, H), 0)
    ImageDraw.Draw(cone).polygon([(1130, 830), (1186, 830), (1360, 1480), (960, 1480)], fill=(120, 96, 50))
    img = screen(img, cone, 30)
    img = glow(img, (1158, 822), 40, (255, 220, 160), blur=20)
    img = glow(img, (870, 1300), 60, (120, 100, 60), blur=40)
    # 비
    lay = layer()
    d = ImageDraw.Draw(lay)
    rr = random.Random(11)
    for _ in range(900):
        x, y, l = rr.uniform(-100, W), rr.uniform(-100, H), rr.uniform(30, 90)
        d.line([x, y, x + l * 0.22, y + l], fill=(170, 200, 230, rr.randint(40, 110)), width=2)
    img = comp(img, lay)
    img = vignette(img, 0.5)
    img = bottom_fade(img, 0.7)
    img = draw_text(img, 150, "막차는 이미 떠났다", F(["NotoSerifKR-Light.ttf", "NanumMyeongjo.ttf"], 54), (210, 225, 235, 255), spacing=14)
    img = draw_text(img, 1400, "심야 정류장", F(["NotoSerifKR-Black.ttf", "NanumMyeongjoExtraBold.ttf"], 186), (245, 246, 240, 255), spacing=8,
                    shadow=(0, 8, 14, (0, 0, 0, 200)))
    img = draw_text(img, 1640, "MIDNIGHT  TERMINAL", F("bahnschrift.ttf", 46, "SemiBold SemiCondensed"), (140, 200, 230, 255), spacing=22)
    return footer(img, ["감독 한도윤   각본 오세라   촬영 민재건   음악 류하진",
                        "출연 서지안 · 강민호 · 윤채령 · 백도현"], "11월 6일 대개봉", "15")


# ---------------------------------------------------------------------- 2. 여름의 끝에서
def p_summer():
    HZ = 1210
    img = grad([(0, (58, 46, 118)), (0.3, (196, 96, 130)), (0.52, (250, 150, 110)), (HZ / H, (255, 214, 150)), (HZ / H + 0.001, (90, 80, 140)), (1, (24, 22, 60))])
    # 구름
    lay = layer()
    d = ImageDraw.Draw(lay)
    rr = random.Random(21)
    for _ in range(26):
        cx, cy = rr.uniform(-100, W + 100), rr.uniform(200, 900)
        rx, ry = rr.uniform(120, 300), rr.uniform(26, 60)
        d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(255, 190, 180, rr.randint(50, 110)))
    img = comp(img, lay, 18)
    img = glow(img, (700, HZ), 520, (150, 70, 40), blur=240)
    sun = layer()
    ImageDraw.Draw(sun).ellipse([700 - 220, HZ - 220, 700 + 220, HZ + 220], fill=(255, 240, 200, 255))
    sun = Image.composite(sun, layer(), _above(HZ))
    img = comp(img, sun)
    img = glow(img, (700, HZ - 60), 260, (120, 80, 40), blur=90)
    # 물결 반사
    lay = layer()
    d = ImageDraw.Draw(lay)
    rr = random.Random(5)
    for k in range(40):
        y = HZ + 14 + k * 17
        half = 250 * (1 - k / 46) + rr.uniform(-40, 40)
        for _ in range(3):
            x = 700 + rr.uniform(-half, half)
            l = rr.uniform(40, 160) * (1 - k / 60)
            d.rounded_rectangle([x - l / 2, y, x + l / 2, y + 6], radius=3, fill=(255, 220, 170, int(220 * (1 - k / 44))))
    img = comp(img, lay, 1.5)
    # 부두 + 두 사람
    lay = layer()
    d = ImageDraw.Draw(lay)
    K = (30, 18, 40, 255)
    d.polygon([(-10, 1400), (980, 1352), (980, 1372), (-10, 1450)], fill=K)
    for px in range(40, 980, 120):
        y = 1400 - px * 0.049
        d.rectangle([px, y, px + 14, y + 220], fill=K)
    for sx in (838, 900):
        d.ellipse([sx, 1268, sx + 40, 1308], fill=K)
        d.rounded_rectangle([sx - 8, 1306, sx + 48, 1362], radius=14, fill=K)
    d.line([878, 1330, 902, 1324], fill=K, width=10)  # 맞잡은 손
    img = comp(img, lay)
    img = bottom_fade(img, 0.74, (16, 10, 40))
    img = draw_text(img, 210, "여름의 끝에서", F(["NanumMyeongjoExtraBold.ttf", "NotoSerifKR-Black.ttf"], 160), (255, 250, 240, 255), spacing=6,
                    shadow=(0, 6, 16, (90, 30, 60, 170)))
    img = draw_text(img, 420, "THE  LAST  SUMMER", F("georgiai.ttf", 56), (255, 230, 210, 255), spacing=14)
    img = draw_text(img, 1560, "우리가 마지막으로 웃었던 계절", F(["NotoSerifKR-Medium.ttf", "NanumMyeongjoBold.ttf"], 58), (255, 236, 220, 255), spacing=6)
    return footer(img, ["감독 이수아   각본 정하늘   촬영 문태오   음악 김새벽",
                        "출연 차유진 · 한서윤 · 오다온 · 남궁별"], "7월 24일 개봉", "12", color=(225, 205, 220))


def _above(hz):
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).rectangle([0, 0, W, hz], fill=255)
    return m


# ---------------------------------------------------------------------- 3. 궤도 이탈
def p_orbit():
    img = grad([(0, (4, 3, 14)), (0.5, (10, 6, 26)), (1, (2, 2, 8))])
    neb = Image.new("RGB", (W, H), 0)
    d = ImageDraw.Draw(neb)
    rr = random.Random(31)
    for _ in range(18):
        cx, cy, r = rr.uniform(0, W), rr.uniform(200, 1500), rr.uniform(120, 380)
        c = rr.choice([(80, 30, 120), (20, 80, 120), (120, 30, 80), (30, 40, 110)])
        d.ellipse([cx - r, cy - r * 0.6, cx + r, cy + r * 0.6], fill=c)
    img = screen(img, neb, 120)
    img = stars(img, 900, 32, big=0.02)
    for xy, s in (((260, 560), 70), ((1180, 300), 50), ((980, 900), 40)):
        img = flare(img, xy, s, (210, 230, 255))
    # 행성 + 고리
    cx, cy, R = 1000, 1480, 600
    planet = Image.new("RGB", (W, H), 0)
    d = ImageDraw.Draw(planet)
    bands = [(214, 140, 90), (180, 100, 70), (230, 170, 120), (150, 80, 60), (210, 150, 100), (170, 110, 80)]
    rr = random.Random(9)
    y = cy - R
    while y < cy + R:
        h = rr.randint(30, 110)
        d.rectangle([0, y, W, y + h], fill=rr.choice(bands))
        y += h
    planet = planet.filter(ImageFilter.GaussianBlur(10))
    shade = Image.new("L", (W, H), 0)
    ImageDraw.Draw(shade).ellipse([cx - R * 1.35 - 260, cy - R * 1.35 - 300, cx + R * 1.35 - 260, cy + R * 1.35 - 300], fill=255)
    shade = shade.filter(ImageFilter.GaussianBlur(160))
    planet = Image.composite(planet, Image.new("RGB", (W, H), (12, 6, 10)), shade)
    disc = Image.new("L", (W, H), 0)
    ImageDraw.Draw(disc).ellipse([cx - R, cy - R, cx + R, cy + R], fill=255)
    ring = layer()
    rd = ImageDraw.Draw(ring)
    for k, (rx, col) in enumerate(((1.75, (230, 200, 160, 200)), (1.62, (200, 170, 140, 150)), (1.5, (240, 215, 180, 210)))):
        rd.ellipse([cx - R * rx, cy - R * rx * 0.2, cx + R * rx, cy + R * rx * 0.2], outline=col, width=22 - k * 4)
    back = Image.composite(ring, layer(), _above(cy))
    front = Image.composite(layer(), ring, _above(cy))
    back, front = (x.rotate(-14, center=(cx, cy), resample=Image.BICUBIC) for x in (back, front))
    img = comp(img, back)
    img = Image.composite(planet, img, disc)
    img = glow(img, (cx - 260, cy - 300), 200, (60, 40, 30), blur=180)
    img = comp(img, front)
    # 우주비행사
    lay = layer()
    d = ImageDraw.Draw(lay)
    ax, ay = 430, 820
    d.line([(ax - 10, ay + 60), (ax - 160, ay + 10), (ax - 300, ay - 160), (ax - 520, ay - 220)], fill=(200, 210, 230, 160), width=4, joint="curve")
    d.rounded_rectangle([ax - 34, ay + 20, ax + 40, ay + 120], radius=26, fill=(235, 238, 245, 255))
    d.ellipse([ax - 36, ay - 50, ax + 36, ay + 22], fill=(235, 238, 245, 255))
    d.ellipse([ax - 22, ay - 34, ax + 24, ay + 6], fill=(60, 90, 140, 255))
    d.line([ax - 30, ay + 46, ax - 80, ay + 4], fill=(235, 238, 245, 255), width=22)
    d.line([ax + 34, ay + 50, ax + 70, ay + 108], fill=(235, 238, 245, 255), width=22)
    d.line([ax - 14, ay + 110, ax - 40, ay + 190], fill=(235, 238, 245, 255), width=24)
    d.line([ax + 20, ay + 110, ax + 46, ay + 180], fill=(235, 238, 245, 255), width=24)
    img = comp(img, lay)
    img = glow(img, (ax, ay + 40), 90, (40, 50, 80), blur=50)
    img = bottom_fade(img, 0.76)
    img = draw_text(img, 130, "지구까지 38만 km.  남은 산소는 6시간.", F(["NotoSansKR-Medium.ttf", "malgun.ttf"], 50), (200, 215, 240, 255), spacing=4)
    img = draw_text(img, 250, "궤도 이탈", F(["WantedSans-ExtraBlack.ttf", "NotoSansKR-Black.ttf"], 230), (250, 250, 255, 255), spacing=24,
                    glow_col=((60, 90, 160), 30))
    img = draw_text(img, 520, "O R B I T   Z E R O", F("bahnschrift.ttf", 54, "Bold"), (160, 190, 255, 255), spacing=10)
    return footer(img, ["감독 장태민   각본 윤시후   시각효과 STUDIO NOVA   음악 하이안",
                        "출연 권도하 · 마리아 셰퍼 · 송이결 · 최준혁"], "COMING SOON", "12", color=(170, 180, 205))


# ---------------------------------------------------------------------- 4. 고양이 탐정 모모
def p_momo():
    Y = (255, 204, 40)
    img = Image.new("RGB", (W, H), Y)
    lay = layer()
    d = ImageDraw.Draw(lay)
    cx, cy = 700, 1020
    for k in range(24):
        a0, a1 = k * 15, k * 15 + 7.5
        p = [(cx, cy)] + [(cx + 2400 * math.cos(math.radians(a)), cy + 2400 * math.sin(math.radians(a))) for a in (a0, a1)]
        d.polygon(p, fill=(255, 225, 90, 255))
    img = comp(img, lay)
    lay = layer()
    d = ImageDraw.Draw(lay)
    for yy in range(0, H, 36):
        for xx in range(0 if (yy // 36) % 2 == 0 else 18, W, 36):
            r = 3 + 6 * (yy / H)
            d.ellipse([xx - r, yy - r, xx + r, yy + r], fill=(235, 160, 20, 90))
    img = comp(img, lay)
    BR = (92, 48, 24, 255)
    O = (246, 140, 48, 255)
    lay = layer()
    d = ImageDraw.Draw(lay)
    # 귀
    d.polygon([(390, 840), (450, 560), (620, 720)], fill=O, outline=BR, width=12)
    d.polygon([(1010, 840), (950, 560), (780, 720)], fill=O, outline=BR, width=12)
    d.polygon([(440, 780), (465, 640), (560, 730)], fill=(255, 170, 170, 255))
    d.polygon([(960, 780), (935, 640), (840, 730)], fill=(255, 170, 170, 255))
    # 머리
    d.ellipse([cx - 380, cy - 330, cx + 380, cy + 340], fill=O, outline=BR, width=14)
    for k in (-1, 0, 1):
        d.polygon([(cx + k * 90 - 26, cy - 326), (cx + k * 90 + 26, cy - 326), (cx + k * 70, cy - 220)], fill=(220, 110, 30, 255))
    # 볼
    d.ellipse([cx - 300, cy + 60, cx - 170, cy + 150], fill=(255, 150, 140, 200))
    d.ellipse([cx + 170, cy + 60, cx + 300, cy + 150], fill=(255, 150, 140, 200))
    # 눈 (한쪽으로 흘겨봄)
    for ex in (cx - 150, cx + 150):
        d.ellipse([ex - 78, cy - 110, ex + 78, cy + 40], fill=(255, 255, 255, 255), outline=BR, width=10)
        d.ellipse([ex - 6, cy - 80, ex + 64, cy + 20], fill=(30, 20, 14, 255))
        d.ellipse([ex + 18, cy - 66, ex + 40, cy - 44], fill=(255, 255, 255, 255))
    d.line([cx - 230, cy - 150, cx - 80, cy - 128], fill=BR, width=14)
    d.line([cx + 80, cy - 128, cx + 230, cy - 150], fill=BR, width=14)
    d.polygon([(cx - 34, cy + 70), (cx + 34, cy + 70), (cx, cy + 110)], fill=(255, 110, 130, 255))
    d.arc([cx - 70, cy + 80, cx, cy + 150], 0, 180, fill=BR, width=10)
    d.arc([cx, cy + 80, cx + 70, cy + 150], 0, 180, fill=BR, width=10)
    for s in (-1, 1):
        for k, dy in enumerate((-10, 30, 70)):
            d.line([cx + s * 200, cy + 90 + dy * 0.4, cx + s * 420, cy + 50 + dy], fill=BR, width=8)
    # 탐정 모자
    d.chord([cx - 300, cy - 560, cx + 300, cy - 120], 180, 360, fill=(150, 110, 70, 255), outline=BR, width=12)
    d.rounded_rectangle([cx - 360, cy - 360, cx + 360, cy - 310], radius=24, fill=(120, 84, 50, 255), outline=BR, width=10)
    for k in range(-5, 6):
        d.line([cx + k * 50, cy - 540 + abs(k) * 14, cx + k * 50, cy - 362], fill=(130, 92, 56, 255), width=6)
    img = comp(img, lay)
    # 돋보기
    lay = layer()
    d = ImageDraw.Draw(lay)
    mx, my, mr = 1060, 1310, 150
    d.line([mx + 100, my + 100, mx + 250, my + 250], fill=BR, width=48)
    d.ellipse([mx - mr, my - mr, mx + mr, my + mr], fill=(200, 240, 255, 110), outline=BR, width=30)
    d.arc([mx - mr + 40, my - mr + 40, mx + mr - 40, my + mr - 40], 200, 250, fill=(255, 255, 255, 230), width=14)
    img = comp(img, lay)
    img = draw_text(img, 130, "사라진 생선 통조림의 비밀을 찾아라!", F(["BMHANNAPro.ttf", "NotoSansKR-Black.ttf"], 64), (92, 48, 24, 255), spacing=2)
    img = draw_text(img, 1420, "고양이 탐정 모모", F(["BMJUA_ttf.ttf", "NotoSansKR-Black.ttf"], 172), (255, 255, 255, 255), stroke=16, stroke_fill=(92, 48, 24),
                    shadow=(0, 14, 0, (92, 48, 24, 255)))
    img = draw_text(img, 1650, "DETECTIVE  MOMO", F(["ariblk.ttf"], 54), (92, 48, 24, 255), spacing=8)
    return footer(img, ["감독 노을빛   각본 하루하   애니메이션 스튜디오 뭉게   음악 도레미",
                        "목소리 출연 윤봄 · 김차돌 · 박말랑 · 이콩콩"], "겨울방학 대개봉", "ALL", color=(92, 48, 24), accent=(92, 48, 24))


# ---------------------------------------------------------------------- 5. 레드 라인
def p_redline():
    img = grad([(0, (18, 18, 22)), (1, (6, 6, 8))])
    img = grain(img, 25)
    ang = -24
    P = 700                                  # 회전해도 띠 끝이 화면 안에 보이지 않도록 넓은 캔버스에 그린 뒤 잘라냄
    band = Image.new("RGBA", (W + 2 * P, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(band)
    d.rectangle([0, 720, W + 2 * P, 1120], fill=(214, 20, 32, 255))
    rr = random.Random(51)
    for _ in range(110):
        y = rr.uniform(730, 1110)
        x = rr.uniform(0, W + 2 * P)
        l = rr.uniform(120, 520)
        d.line([x, y, x + l, y], fill=(255, 255, 255, rr.randint(30, 150)), width=rr.choice([2, 3, 4]))
    big = F(["impact.ttf", "ariblk.ttf"], 330)
    tw = big.getlength("RED LINE")
    d.text((P + W / 2 - tw / 2, 750), "RED LINE", font=big, fill=(18, 6, 8, 255))
    band = band.rotate(-ang, center=(P + W / 2, 920), resample=Image.BICUBIC).crop((P, 0, P + W, H))
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow.putalpha(band.getchannel("A").point(lambda v: int(v * 0.8)))
    img = comp(img, shadow.transform((W, H), Image.AFFINE, (1, 0, -10, 0, 1, -30)), 30)
    img = comp(img, band)
    # 불꽃
    g = Image.new("RGB", (W, H), 0)
    d = ImageDraw.Draw(g)
    rr = random.Random(52)
    for _ in range(160):
        t = rr.uniform(0, 1)
        x = t * W
        y = 920 + (W / 2 - x) * math.tan(math.radians(-ang)) + rr.uniform(-280, 280)
        r = rr.uniform(2, 6)
        d.ellipse([x - r, y - r, x + r, y + r], fill=rr.choice([(255, 180, 60), (255, 120, 30), (255, 230, 150)]))
    img = screen(img, g, 1.5)
    img = screen(img, g, 8)
    img = vignette(img, 0.4)
    img = draw_text(img, 170, "멈추는 순간, 끝이다.", F(["NotoSansKR-Black.ttf", "malgunbd.ttf"], 70), (245, 245, 245, 255), spacing=6)
    img = draw_text(img, 280, "72시간 · 서울 → 부산 · 브레이크 없는 질주", F(["NotoSansKR-Medium.ttf", "malgun.ttf"], 40), (220, 60, 60, 255), spacing=3)
    img = bottom_fade(img, 0.76)
    img = draw_text(img, 1420, "레 드  라 인", F(["NotoSansKR-Black.ttf", "malgunbd.ttf"], 200), (255, 255, 255, 255), spacing=10,
                    shadow=(0, 10, 12, (0, 0, 0, 220)))
    lay = layer()
    ImageDraw.Draw(lay).rectangle([W / 2 - 300, 1700, W / 2 + 300, 1710], fill=(214, 20, 32, 255))
    img = comp(img, lay)
    return footer(img, ["감독 백강철   각본 진세윤   무술감독 탁무열   음악 BEAT FACTORY",
                        "출연 강태산 · 류다인 · 조민혁 · 하예솔"], "10월 30일 대개봉", "18", color=(180, 180, 185))


# ---------------------------------------------------------------------- 6. 안개 숲의 노래
def ridge(seed, y0, amp, n=9):
    rr = random.Random(seed)
    pts = []
    for i in range(n + 1):
        pts.append((i * W / n, y0 + rr.uniform(-amp, amp)))
    out = []
    for i in range(len(pts) - 1):
        (x0, a), (x1, b) = pts[i], pts[i + 1]
        for k in range(20):
            t = k / 20
            out.append((x0 + (x1 - x0) * t, a + (b - a) * (1 - math.cos(t * math.pi)) / 2))
    return out + [(W, H), (0, H)]


def pine(d, x, base, h, col):
    w = h * 0.36
    for k in range(5):
        top = base - h + k * h * 0.17
        bw = w * (0.35 + k * 0.17)
        d.polygon([(x, top), (x - bw, top + h * 0.3), (x + bw, top + h * 0.3)], fill=col)
    d.rectangle([x - h * 0.02, base - h * 0.1, x + h * 0.02, base], fill=col)


def p_forest():
    img = grad([(0, (14, 40, 52)), (0.35, (60, 120, 120)), (0.55, (170, 205, 190)), (1, (20, 46, 44))])
    img = glow(img, (700, 760), 360, (90, 110, 80), blur=200)
    lay = layer()
    ImageDraw.Draw(lay).ellipse([700 - 150, 760 - 150, 700 + 150, 760 + 150], fill=(250, 248, 225, 235))
    img = comp(img, lay, 4)
    cols = [(110, 160, 150), (78, 128, 120), (50, 96, 92), (30, 66, 64), (14, 36, 36)]
    for k, col in enumerate(cols):
        lay = layer()
        d = ImageDraw.Draw(lay)
        y0 = 980 + k * 170
        d.polygon(ridge(60 + k, y0, 90 - k * 10), fill=col + (255,))
        if k >= 2:
            rr = random.Random(70 + k)
            for _ in range(10 + k * 6):
                x = rr.uniform(-40, W + 40)
                h = rr.uniform(160, 260) * (0.7 + k * 0.25)
                pine(d, x, y0 + rr.uniform(20, 140), h, col + (255,))
        img = comp(img, lay, max(0, 3 - k) * 2)
        fog = layer()
        fd = ImageDraw.Draw(fog)
        for y in range(y0 + 40, min(H, y0 + 260)):
            t = (y - y0 - 40) / 220
            fd.line([0, y, W, y], fill=(220, 236, 226, int(110 * math.sin(t * math.pi) * (1 - k * 0.15))))
        img = comp(img, fog, 20)
    # 반딧불
    g = Image.new("RGB", (W, H), 0)
    d = ImageDraw.Draw(g)
    rr = random.Random(77)
    for _ in range(90):
        x, y, r = rr.uniform(60, W - 60), rr.uniform(1150, 1800), rr.uniform(3, 7)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(220, 255, 140))
    img = screen(img, g, 1)
    img = screen(img, g, 10)
    img = bottom_fade(img, 0.78, (6, 20, 20))
    img = draw_text(img, 230, "안개 숲의 노래", F(["NanumMyeongjoExtraBold.ttf", "NotoSerifKR-Black.ttf"], 150), (236, 248, 238, 255), spacing=8,
                    shadow=(0, 6, 18, (10, 40, 40, 200)))
    img = draw_text(img, 440, "SONG OF THE MISTY FOREST", F(["Cinzel-Black.ttf", "georgiab.ttf"], 46), (220, 240, 225, 255), spacing=8)
    img = draw_text(img, 1600, "숲이 기억하는 마지막 노래를 찾아서", F(["NotoSerifKR-Medium.ttf", "NanumMyeongjoBold.ttf"], 52), (225, 245, 230, 255), spacing=5)
    return footer(img, ["감독 서도림   원작 「숲의 문」   미술 연초록   음악 바람소리 앙상블",
                        "출연 이나래 · 진솔 · 허 산 · 목련"], "12월 18일 개봉", "ALL", color=(190, 215, 205))


# ---------------------------------------------------------------------- 7. 앵콜
def p_encore():
    img = grad([(0, (16, 4, 34)), (0.55, (52, 10, 70)), (0.8, (110, 20, 90)), (1, (20, 4, 24))])
    img = glow(img, (700, 1150), 520, (130, 60, 150), blur=220)
    for x0, x1, col in ((160, 520, (160, 40, 140)), (1240, 880, (40, 90, 180)), (500, 700, (150, 150, 170)), (900, 700, (150, 150, 170)), (700, 700, (120, 60, 160))):
        g = Image.new("RGB", (W, H), 0)
        ImageDraw.Draw(g).polygon([(x0 - 18, -20), (x0 + 18, -20), (x1 + 240, 1500), (x1 - 240, 1500)], fill=col)
        img = screen(img, g, 40)
    img = glow(img, (700, 1180), 230, (255, 230, 255), blur=90)
    # 가수 실루엣 + 마이크 스탠드
    lay = layer()
    d = ImageDraw.Draw(lay)
    K = (12, 2, 16, 255)
    d.ellipse([668, 950, 732, 1016], fill=K)
    d.polygon([(650, 1020), (750, 1020), (770, 1200), (730, 1200), (735, 1400), (705, 1400), (700, 1260), (695, 1400), (665, 1400), (670, 1200), (630, 1200)], fill=K)
    d.line([750, 1040, 840, 960], fill=K, width=22)          # 치켜든 팔
    d.line([640, 1040, 600, 1120], fill=K, width=20)
    d.line([600, 1120, 640, 1000], fill=K, width=6)
    d.rectangle([636, 1000, 644, 1400], fill=K)               # 스탠드
    d.rectangle([0, 1400, W, 1440], fill=K)                   # 무대
    img = comp(img, lay)
    # 응원봉 + 관객
    g = Image.new("RGB", (W, H), 0)
    d = ImageDraw.Draw(g)
    lay = layer()
    ld = ImageDraw.Draw(lay)
    rr = random.Random(88)
    for row, (y, s) in enumerate(((1560, 0.7), (1680, 0.85), (1820, 1.0))):
        x = -30 + row * 20
        while x < W + 40:
            r = 34 * s
            ld.ellipse([x - r, y - r, x + r, y + r], fill=(6, 0, 8, 255))
            ld.rounded_rectangle([x - r * 1.5, y + r * 0.7, x + r * 1.5, H], radius=int(r), fill=(6, 0, 8, 255))
            if rr.random() < 0.55:
                ax, ay = x + rr.uniform(-60, 60) * s, y - rr.uniform(120, 190) * s
                ld.line([x + r * 0.6, y + r, ax, ay], fill=(6, 0, 8, 255), width=int(18 * s))
                if rr.random() < 0.7:
                    c = rr.choice([(255, 60, 180), (80, 160, 255), (255, 220, 60), (120, 255, 160)])
                    d.line([ax, ay, ax + rr.uniform(-20, 20), ay - 60 * s], fill=c, width=int(12 * s))
            x += rr.uniform(70, 110) * s
    img = comp(img, lay)
    img = screen(img, g, 0)
    img = screen(img, g, 12)
    # 종이 꽃가루
    lay = layer()
    rr = random.Random(89)
    for _ in range(140):
        piece = Image.new("RGBA", (28, 14), rr.choice([(255, 80, 180), (255, 230, 90), (90, 200, 255), (255, 255, 255)]) + (rr.randint(150, 240),))
        piece = piece.rotate(rr.uniform(0, 180), expand=True)
        lay.alpha_composite(piece, (int(rr.uniform(0, W - 30)), int(rr.uniform(500, 1500))))
    img = comp(img, lay)
    img = draw_text(img, 120, "단 하룻밤, 다시 없을 무대", F(["NotoSansKR-Bold.ttf", "malgunbd.ttf"], 58), (255, 220, 250, 255), spacing=6)
    img = draw_text(img, 210, "앵콜", F(["NotoSansKR-Black.ttf", "malgunbd.ttf"], 330), (255, 255, 255, 255), spacing=30,
                    glow_col=((220, 60, 200), 40))
    img = draw_text(img, 610, "E N C O R E   ·   L I V E   I N   C I N E M A", F("bahnschrift.ttf", 42, "Bold"), (255, 200, 245, 255), spacing=4)
    lay = layer()
    d = ImageDraw.Draw(lay)
    fb = F(["NotoSansKR-Bold.ttf", "malgunbd.ttf"], 40)
    label = "폭음시네마 단독 상영"
    lw = text_width(fb, label, 4)
    d.rounded_rectangle([W / 2 - lw / 2 - 34, 700, W / 2 + lw / 2 + 34, 772], radius=36, outline=(255, 200, 245, 255), width=4)
    img = comp(img, lay)
    img = draw_text(img, 710, label, fb, (255, 230, 250, 255), spacing=4)
    img = bottom_fade(img, 0.84)
    return footer(img, ["연출 문하람   공연 THE SIGNAL BAND   음향 폭음사운드랩",
                        "2시간 18분 · 콘서트 실황 · 폭음시네마 돌비 애트모스"], "이번 주말 단 3회", "ALL", color=(220, 190, 225))


# ---------------------------------------------------------------------- 8. 북극성
def p_polaris():
    img = grad([(0, (4, 8, 28)), (0.45, (10, 34, 62)), (0.62, (30, 70, 96)), (1, (8, 18, 34))])
    img = stars(img, 700, 91, y1=H * 0.62)
    # 오로라
    for k, (col, y0, amp, ph) in enumerate((((40, 220, 150), 600, 140, 0.0), ((30, 160, 200), 720, 110, 1.3), ((150, 70, 200), 520, 90, 2.4))):
        g = Image.new("RGB", (W, H), 0)
        d = ImageDraw.Draw(g)
        for x in range(-40, W + 40, 6):
            y = y0 + amp * math.sin(x / 260 + ph) + 50 * math.sin(x / 90 + ph * 2)
            d.line([x, y - 260, x, y], fill=tuple(int(c * 0.35) for c in col), width=7)
            d.line([x, y - 40, x, y], fill=col, width=7)
        img = screen(img, g, 26)
    img = flare(img, (700, 300), 150, (230, 240, 255))
    # 설산
    lay = layer()
    d = ImageDraw.Draw(lay)
    peaks = [(-100, 1500, 260, 1080, 620), (380, 1500, 760, 960, 1140), (900, 1500, 1200, 1100, 1560)]
    for x0, yb, px, py, x1 in peaks:
        d.polygon([(x0, yb), (px, py), (x1, yb)], fill=(170, 196, 222, 255))
        d.polygon([(px, py), (x1, yb), (px + (x1 - px) * 0.15, yb)], fill=(90, 116, 150, 255))
        d.polygon([(px, py), (px - (px - x0) * 0.28, py + (yb - py) * 0.28), (px - 20, py + 160), (px + 30, py + 120), (px + (x1 - px) * 0.25, py + (yb - py) * 0.25)], fill=(236, 244, 252, 255))
    d.polygon(ridge(95, 1480, 40), fill=(210, 226, 240, 255))
    img = comp(img, lay)
    lay = layer()
    d = ImageDraw.Draw(lay)
    d.polygon([(560, 1610), (640, 1500), (720, 1610)], fill=(255, 150, 60, 255))
    d.polygon([(640, 1500), (720, 1610), (650, 1610)], fill=(210, 100, 40, 255))
    d.ellipse([820, 1552, 846, 1578], fill=(30, 40, 60, 255))
    d.rounded_rectangle([812, 1576, 854, 1640], radius=12, fill=(30, 40, 60, 255))
    d.line([846, 1586, 880, 1540], fill=(30, 40, 60, 255), width=10)   # 별을 가리키는 손
    img = comp(img, lay)
    img = glow(img, (640, 1580), 120, (140, 80, 30), blur=60)
    img = bottom_fade(img, 0.8, (6, 12, 26), 245)
    img = draw_text(img, 470, "북 극 성", F(["NotoSerifKR-Black.ttf", "NanumMyeongjoExtraBold.ttf"], 200), (250, 252, 255, 255), spacing=20,
                    shadow=(0, 6, 20, (0, 10, 30, 220)))
    img = draw_text(img, 710, "P O L A R I S", F(["Cinzel-Black.ttf", "georgiab.ttf"], 52), (190, 230, 255, 255), spacing=12)
    img = draw_text(img, 1680, "가장 먼 곳에서, 너를 불렀다", F(["NotoSerifKR-Medium.ttf", "NanumMyeongjoBold.ttf"], 54), (225, 236, 250, 255), spacing=6)
    return footer(img, ["감독 오로라   각본 한겨울   촬영 설원석   음악 북쪽바다",
                        "출연 정하람 · 이누리 · 신별 · 고은설"], "2027년 1월 개봉", "12", color=(180, 200, 225))


POSTERS = [p_midnight, p_summer, p_orbit, p_momo, p_redline, p_forest, p_encore, p_polaris]


def main():
    os.makedirs(OUT_CLIENT, exist_ok=True)
    SW, SH = 512, 768
    atlas = Image.new("RGB", (SW * 4, SH * 2))
    for i, fn in enumerate(POSTERS):
        img = grain(fn(), 6)
        small = img.resize((700, 1000), Image.LANCZOS)
        small.save(os.path.join(OUT_CLIENT, f"poster_{i + 1}.jpg"), quality=88)
        atlas.paste(img.resize((SW, SH), Image.LANCZOS), ((i % 4) * SW, (i // 4) * SH))
        print("poster", i + 1, fn.__name__)
    atlas.save(OUT_ATLAS, quality=90)
    print("atlas", OUT_ATLAS)


if __name__ == "__main__":
    main()
