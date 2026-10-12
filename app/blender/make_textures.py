# 사이버 홍대입구 - 맵 텍스처 생성기 (PIL)
# 사용: python make_textures.py  → ./textures/*.png|jpg
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "textures")
os.makedirs(OUT, exist_ok=True)
FONTS = "C:/Windows/Fonts/"
R = random.Random(4)


def font(name, size):
    return ImageFont.truetype(FONTS + name, size)


def save(img, name):
    p = os.path.join(OUT, name)
    if name.endswith(".jpg"):
        img.convert("RGB").save(p, quality=88)
    else:
        img.save(p)
    print("tex", name)


def noise_img(size, base, amp, blur=0, seed=0):
    rr = random.Random(seed)
    img = Image.new("RGB", (size, size), base)
    px = img.load()
    for y in range(size):
        for x in range(size):
            d = rr.randint(-amp, amp)
            px[x, y] = tuple(max(0, min(255, c + d)) for c in base)
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    return img


# ---------- 바닥 ----------
def wood_tile():
    # 4관 입구 앞 우드톤 포세린 타일 (1장 = 1.2m x 0.2m, 텍스처 1장 = 2.4m x 2.4m)
    S = 1024
    img = Image.new("RGB", (S, S))
    d = ImageDraw.Draw(img)
    rows = 12
    h = S // rows
    for r in range(rows):
        off = R.randint(0, S)
        x = -off
        while x < S:
            w = S // 2
            tone = R.randint(-14, 14)
            base = (196 + tone, 186 + tone, 170 + tone)
            d.rectangle([x, r * h, x + w, r * h + h], fill=base)
            for k in range(14):
                yy = r * h + R.randint(2, h - 2)
                c = tuple(v - R.randint(8, 22) for v in base)
                d.line([x, yy, x + w, yy + R.randint(-2, 2)], fill=c, width=1)
            d.line([x, r * h, x, r * h + h], fill=(150, 142, 130), width=2)
            x += w
        d.line([0, r * h, S, r * h], fill=(150, 142, 130), width=2)
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    save(img, "floor_wood.jpg")


def dark_tile():
    # 진회색 대형 포세린 타일 (600mm) 텍스처 1장 = 2.4m → 4x4
    S = 1024
    img = noise_img(S, (78, 80, 84), 10, 1.2, 1)
    d = ImageDraw.Draw(img)
    n = 4
    for i in range(n):
        for j in range(n):
            t = R.randint(-8, 8)
            ov = Image.new("RGB", (S // n, S // n), (78 + t, 80 + t, 86 + t))
            img.paste(Image.blend(img.crop((i * S // n, j * S // n, (i + 1) * S // n, (j + 1) * S // n)), ov, 0.5), (i * S // n, j * S // n))
    for i in range(n + 1):
        d.line([i * S // n, 0, i * S // n, S], fill=(40, 40, 42), width=3)
        d.line([0, i * S // n, S, i * S // n], fill=(40, 40, 42), width=3)
    save(img, "floor_dark.jpg")


def carpet():
    # 롯데시네마 남색 카펫 + 금색 소용돌이 (텍스처 1장 = 2m)
    S = 1024
    img = noise_img(S, (24, 30, 62), 9, 0.8, 2)
    d = ImageDraw.Draw(img)
    rr = random.Random(7)
    for _ in range(26):
        cx, cy = rr.randint(0, S), rr.randint(0, S)
        rad = rr.randint(40, 120)
        col = rr.choice([(214, 170, 56), (190, 150, 50), (120, 170, 210), (226, 196, 90)])
        w = rr.randint(5, 10)
        turns = rr.uniform(1.2, 2.2)
        pts = []
        for k in range(120):
            t = k / 119
            a = t * turns * 2 * math.pi + rr.random() * 0.01
            r = rad * (1 - t * 0.85)
            pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
        for ox in (-S, 0, S):
            for oy in (-S, 0, S):
                d.line([(x + ox, y + oy) for x, y in pts], fill=col, width=w, joint="curve")
    for _ in range(40):
        cx, cy = rr.randint(0, S), rr.randint(0, S)
        r = rr.randint(10, 22)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(214, 170, 56), width=5)
    img = img.filter(ImageFilter.GaussianBlur(0.7))
    save(img, "carpet.jpg")


def carpet_dark():
    S = 512
    img = noise_img(S, (22, 24, 40), 10, 0.7, 3)
    save(img, "carpet_dark.jpg")


# ---------- 벽 ----------
def stone_panel():
    # 로비 회색 석재 패널(리벳 점) 1장 = 2.4m x 2.4m → 패널 1.2 x 0.6
    S = 1024
    img = noise_img(S, (128, 128, 126), 14, 1.0, 5)
    d = ImageDraw.Draw(img)
    for row in range(4):
        y = row * S // 4
        shift = (S // 4) if row % 2 else 0
        for col in range(3):
            x = col * S // 2 - shift
            t = R.randint(-10, 10)
            d.rectangle([x + 2, y + 2, x + S // 2 - 2, y + S // 4 - 2], outline=(96, 96, 95), width=3)
            for cx, cy in ((x + 40, y + 40), (x + S // 2 - 40, y + S // 4 - 40)):
                d.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], fill=(150 + t, 150 + t, 148 + t))
    for _ in range(4000):
        x, y = R.randint(0, S - 1), R.randint(0, S - 1)
        c = R.randint(60, 190)
        d.point((x, y), fill=(c, c, c))
    img = img.filter(ImageFilter.GaussianBlur(0.5))
    save(img, "wall_stone.jpg")


def theater_wall():
    # 광음시네마 측벽 - 어두운 거친 석재 블록 (흡음벽 느낌) 1장 = 2m
    S = 1024
    img = Image.new("RGB", (S, S), (34, 32, 31))
    d = ImageDraw.Draw(img)
    rr = random.Random(11)
    bh = S // 8
    for r in range(8):
        x = -rr.randint(0, 120)
        while x < S:
            w = rr.randint(140, 260)
            t = rr.randint(-8, 10)
            d.rounded_rectangle([x + 4, r * bh + 4, x + w - 4, r * bh + bh - 4], radius=10, fill=(52 + t, 49 + t, 46 + t))
            x += w
    img = img.filter(ImageFilter.GaussianBlur(1.5))
    n = noise_img(S, (128, 128, 128), 40, 0.6, 12)
    img = Image.blend(img, Image.composite(img, n, Image.new("L", (S, S), 210)), 0.5)
    save(img, "wall_theater.jpg")


def graffiti():
    # 4관 측벽 그래피티 벽화 (오리지널 추상 디자인)
    W, H = 2048, 1024
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rr = random.Random(21)
    pal = [(250, 214, 40), (90, 170, 255), (240, 240, 240), (255, 90, 160), (130, 230, 140), (160, 120, 255)]
    for _ in range(70):
        x, y = rr.randint(0, W), rr.randint(80, H - 80)
        c = rr.choice(pal) + (rr.randint(120, 220),)
        k = rr.random()
        if k < 0.4:
            pts = [(x + rr.randint(-260, 260), y + rr.randint(-160, 160)) for _ in range(3)]
            d.polygon(pts, fill=c)
        elif k < 0.7:
            r = rr.randint(20, 90)
            d.ellipse([x - r, y - r, x + r, y + r], outline=c, width=rr.randint(6, 16))
        else:
            d.line([x, y, x + rr.randint(-400, 400), y + rr.randint(-120, 120)], fill=c, width=rr.randint(8, 22))
    f = font("ariblk.ttf", 300)
    txt = "KWANG-EUM"
    for dx, dy, col in ((14, 14, (20, 20, 20, 255)), (0, 0, (250, 214, 40, 255))):
        d.text((150 + dx, 300 + dy), txt, font=f, fill=col, stroke_width=14, stroke_fill=(30, 60, 160, 255))
    f2 = font("malgunbd.ttf", 160)
    d.text((1450, 90), "광음", font=f2, fill=(255, 255, 255, 230), stroke_width=8, stroke_fill=(255, 90, 160, 255))
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    save(img, "graffiti.png")


# ---------- 좌석/가구 ----------
def seat_fabric():
    S = 512
    img = noise_img(S, (38, 72, 150), 12, 0.6, 31)
    d = ImageDraw.Draw(img)
    for y in range(0, S, 4):
        d.line([0, y, S, y], fill=(34, 66, 140), width=1)
    save(img, "seat_fabric.jpg")


def seat_logo():
    # 헤드레스트 LOTTE 자수
    W, H = 512, 256
    img = noise_img(W, (40, 76, 156), 10, 0.6, 32).crop((0, 0, W, H))
    d = ImageDraw.Draw(img)
    f = font("seguibl.ttf", 70)
    tw = d.textlength("LOTTE", font=f)
    d.text(((W - tw) / 2, 80), "LOTTE", font=f, fill=(170, 180, 200))
    save(img, "seat_logo.jpg")


def wood():
    S = 512
    img = Image.new("RGB", (S, S), (120, 78, 44))
    d = ImageDraw.Draw(img)
    rr = random.Random(41)
    for y in range(S):
        c = 110 + int(14 * math.sin(y * 0.09 + math.sin(y * 0.013) * 4)) + rr.randint(-4, 4)
        d.line([0, y, S, y], fill=(c, int(c * 0.66), int(c * 0.38)))
    save(img, "wood.jpg")


# ---------- 간판/사인 ----------
def sweet_sign():
    W, H = 1024, 256
    img = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font("seguibli.ttf", 190)
    d.text((40, 10), "Sweet", font=f, fill=(255, 30, 30))
    cx, cy = 790, 120
    d.ellipse([cx - 95, cy - 95, cx + 95, cy + 95], fill=(255, 30, 30))
    d.polygon([(cx - 70, cy + 50), (cx - 110, cy + 120), (cx - 20, cy + 85)], fill=(255, 30, 30))
    f2 = font("ariblk.ttf", 140)
    d.text((cx - 50, cy - 95), "#", font=f2, fill=(255, 220, 30))
    save(img, "sign_sweet.jpg")


def menu_boards():
    W, H = 2048, 320
    img = Image.new("RGB", (W, H), (10, 10, 12))
    d = ImageDraw.Draw(img)
    items = [
        ("더블맥주콤보", "팝콘(L) + 맥주 2", (240, 236, 228), (40, 40, 40)),
        ("방과후 콤보", "팝콘(M) + 음료 2 + 케이크", (250, 225, 235), (180, 40, 90)),
        ("바로팝콘 EXPRESS", "QR로 주문하고 바로 픽업", (30, 30, 34), (255, 220, 40)),
        ("더블콤보", "팝콘 2 + 음료 2  +1,000원 사이즈업", (240, 236, 228), (200, 30, 30)),
    ]
    fw = W // 4
    fb = font("malgunbd.ttf", 54)
    fs = font("malgun.ttf", 30)
    for i, (t, s, bg, fg) in enumerate(items):
        x = i * fw
        d.rectangle([x + 8, 8, x + fw - 8, H - 8], fill=bg)
        d.text((x + 34, 40), t, font=fb, fill=fg)
        d.text((x + 34, 130), s, font=fs, fill=(90, 90, 90) if bg[0] > 100 else (220, 220, 220))
        for k in range(3):
            cx = x + 110 + k * 150
            d.ellipse([cx - 50, 200, cx + 50, 290], fill=(250, 214, 120))
            d.rectangle([cx - 40, 230, cx + 40, 300], fill=(220, 40, 40))
    save(img, "menu_boards.jpg")


def lotte_sign():
    # LOTTE CINEMA ◁ 10F | 4/5/6관 - 화살표 방향별 두 장 (sign_lotte: 왼쪽, sign_lotte_r: 오른쪽)
    for name, right in (("sign_lotte.png", False), ("sign_lotte_r.png", True)):
        W, H = 2048, 512
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        f = font("arialbd.ttf", 200)
        d.text((40, 30), "LOTTE CINEMA", font=f, fill=(225, 25, 35, 255))
        f2 = font("malgunbd.ttf", 120)
        d.ellipse([60, 300, 170, 410], outline=(240, 240, 240, 255), width=10)
        tri = [(145, 355), (105, 325), (105, 385)] if right else [(95, 355), (135, 325), (135, 385)]
        d.polygon(tri, fill=(240, 240, 240, 255))
        d.text((190, 278), "10F", font=f2, fill=(240, 240, 240, 255))
        d.line([440, 300, 440, 430], fill=(240, 240, 240, 255), width=8)
        d.text((470, 278), "4/5/6관", font=f2, fill=(240, 240, 240, 255))
        save(img, name)


def down_sign():
    # 에스컬레이터 옆 브론즈 기둥: '내려가는 곳 / 10F' + 에스컬레이터 픽토그램 (배경 투명)
    W, H = 512, 1024
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fg = (240, 232, 214, 255)
    for text, size, y in (("내려가는 곳", 82, 150), ("10F", 120, 330)):
        f = font("malgunbd.ttf", size)
        bb = d.textbbox((0, 0), text, font=f)
        d.text(((W - (bb[2] - bb[0])) / 2 - bb[0], y - bb[1]), text, font=f, fill=fg)
    x0, y0, s = 146, 560, 220
    d.rectangle([x0, y0, x0 + s, y0 + s], outline=fg, width=10)
    d.line([(x0 + 30, y0 + 70), (x0 + 80, y0 + 70), (x0 + 160, y0 + 150), (x0 + 195, y0 + 150)], fill=fg, width=14, joint="curve")
    d.ellipse([x0 + 92, y0 + 26, x0 + 122, y0 + 56], fill=fg)
    d.line([(x0 + 107, y0 + 60), (x0 + 107, y0 + 100)], fill=fg, width=12)
    d.polygon([(x0 + 150, y0 + 175), (x0 + 195, y0 + 175), (x0 + 195, y0 + 130)], fill=fg)
    save(img, "sign_down.png")


def _center_text(d, cx, y, text, f, fill):
    bb = d.textbbox((0, 0), text, font=f)
    d.text((cx - (bb[2] - bb[0]) / 2 - bb[0], y - bb[1]), text, font=f, fill=fill)


def _popcorn(d, cx, top, s):
    # 빨강/흰 줄무늬 팝콘 통
    w0, w1, h = s * 0.8, s * 0.55, s * 0.9
    for k in range(5):
        x0 = cx - w0 / 2 + k * w0 / 5
        x1 = cx - w1 / 2 + k * w1 / 5
        d.polygon([(x0, top + s * 0.3), (x0 + w0 / 5, top + s * 0.3), (x1 + w1 / 5, top + s * 0.3 + h), (x1, top + s * 0.3 + h)],
                  fill=(225, 35, 45) if k % 2 == 0 else (250, 250, 250))
    for k in range(7):
        d.ellipse([cx - w0 / 2 + k * w0 / 7 - 6, top + s * 0.1 + (k % 2) * 12, cx - w0 / 2 + (k + 1) * w0 / 7 + 10, top + s * 0.38], fill=(255, 236, 170))


def kiosk_atlas():
    # 박스오피스 구역 기기 정면 4종: 티켓·콤보 키오스크 / 핑크 키오스크 / 인형뽑기 안쪽 / ATM
    W, H = 2048, 1024
    img = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(img)
    rr = random.Random(7)
    pink = (238, 70, 120)
    for c, body in ((0, (14, 14, 16)), (1, (245, 205, 220))):
        x = c * 512
        d.rectangle([x, 0, x + 511, H], fill=body)
        d.rectangle([x + 20, 18, x + 491, 78], fill=pink)
        _center_text(d, x + 256, 30, "티켓, 콤보 구입(카드전용)", font("malgunbd.ttf", 30), (255, 255, 255))
        # 화면 (상영작 광고)
        d.rectangle([x + 40, 100, x + 471, 470], fill=(20, 26, 60))
        for k in range(14):
            cx, cy, r = x + rr.randint(60, 450), rr.randint(120, 450), rr.randint(20, 70)
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=rr.choice([(240, 120, 60), (90, 160, 255), (250, 210, 80), (200, 80, 200)]))
        d.rectangle([x + 40, 380, x + 471, 470], fill=(10, 12, 30))
        _center_text(d, x + 256, 395, "NOW SHOWING", font("arialbd.ttf", 46), (255, 255, 255))
        # 카드 리더 / 영수증
        d.rectangle([x + 330, 500, x + 440, 600], fill=(60, 60, 64))
        d.rectangle([x + 70, 530, x + 260, 548], fill=(40, 40, 44))
        # 하단 '바로픽업' 패널
        d.rectangle([x + 40, 640, x + 471, 1000], fill=(10, 10, 12), outline=(80, 80, 84), width=3)
        _center_text(d, x + 256, 665, "이제 매점도", font("malgunbd.ttf", 44), (255, 255, 255))
        _center_text(d, x + 256, 728, "바로픽업", font("malgunbd.ttf", 80), (255, 170, 60))
        _popcorn(d, x + 256, 820, 110)
        _center_text(d, x + 256, 955, "주문 후 교환권으로 SWEET#에서 픽업", font("malgun.ttf", 22), (230, 230, 230))
    # 인형뽑기 안쪽 (인형 더미)
    x = 1024
    d.rectangle([x, 0, x + 511, H], fill=(250, 220, 236))
    for k in range(60):
        cx, cy, r = x + rr.randint(30, 480), rr.randint(560, 1000), rr.randint(28, 55)
        col = rr.choice([(120, 190, 250), (255, 170, 200), (250, 230, 120), (180, 140, 100), (255, 255, 255), (160, 220, 160)])
        d.ellipse([cx - r * 0.55, cy - r * 1.05, cx - r * 0.1, cy - r * 0.6], fill=col)
        d.ellipse([cx + r * 0.1, cy - r * 1.05, cx + r * 0.55, cy - r * 0.6], fill=col)
        d.ellipse([cx - r, cy - r * 0.8, cx + r, cy + r * 0.8], fill=col, outline=(90, 90, 90), width=2)
        d.ellipse([cx - r * 0.35, cy - r * 0.2, cx - r * 0.2, cy - r * 0.05], fill=(30, 30, 30))
        d.ellipse([cx + r * 0.2, cy - r * 0.2, cx + r * 0.35, cy - r * 0.05], fill=(30, 30, 30))
    d.line([(x + 256, 0), (x + 256, 260)], fill=(150, 150, 150), width=6)
    for a in (-1, 1):
        d.line([(x + 256, 260), (x + 256 + a * 50, 330)], fill=(170, 170, 170), width=8)
    # ATM
    x = 1536
    d.rectangle([x, 0, x + 511, 640], fill=(238, 238, 236))
    d.rectangle([x, 640, x + 511, H], fill=(215, 40, 50))
    d.rectangle([x + 90, 90, x + 420, 330], fill=(25, 60, 120))
    _center_text(d, x + 255, 180, "ATM", font("arialbd.ttf", 70), (255, 255, 255))
    for i in range(4):
        for j in range(3):
            d.rectangle([x + 170 + j * 60, 400 + i * 50, x + 215 + j * 60, 438 + i * 50], fill=(150, 150, 155))
    d.rectangle([x + 360, 420, x + 450, 440], fill=(40, 40, 40))
    d.rectangle([x + 360, 520, x + 450, 540], fill=(40, 40, 40))
    _center_text(d, x + 255, 760, "365", font("arialbd.ttf", 90), (255, 255, 255))
    save(img, "kiosk_atlas.jpg")


def box_office_signs():
    text_sign("sign_boxoffice.png", "BOX OFFICE", (236, 236, 236, 255), None, 1024, 200, fnt="arialbd.ttf", size=120)
    text_sign("sign_group.png", "대관 & 단체 안내", (245, 245, 245), (22, 22, 26), 1024, 256, size=110)


def ad_screens():
    # 키오스크 위 가로형 광고 화면 3장
    W, H = 1536, 288
    img = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(img)
    panels = [((250, 250, 252), (30, 70, 160), "LOTTE CINEMA", "MEMBERSHIP"),
              ((180, 225, 245), (20, 60, 110), "SPECIAL", "SCREENING"),
              ((40, 20, 70), (255, 200, 90), "광음시네마", "4관 사운드 체험")]
    for i, (bg, fg, t1, t2) in enumerate(panels):
        x = i * 512
        d.rectangle([x + 4, 4, x + 507, H - 4], fill=bg)
        _center_text(d, x + 256, 70, t1, font("malgunbd.ttf", 62), fg)
        _center_text(d, x + 256, 170, t2, font("malgun.ttf", 42), fg)
    save(img, "ad_screens.jpg")


def text_sign(name, text, fg, bg, w=1024, h=256, fnt="malgunbd.ttf", size=150):
    img = Image.new("RGBA" if bg is None else "RGB", (w, h), bg if bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font(fnt, size)
    bb = d.textbbox((0, 0), text, font=f)
    d.text(((w - (bb[2] - bb[0])) / 2 - bb[0], (h - (bb[3] - bb[1])) / 2 - bb[1]), text, font=f, fill=fg)
    save(img, name)


def vertical_text(name, text, fg, w=256, h=1280, size=190):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font("malgunbd.ttf", size)
    for i, ch in enumerate(text):
        bb = d.textbbox((0, 0), ch, font=f)
        d.text(((w - (bb[2] - bb[0])) / 2 - bb[0], 20 + i * (h - 40) / len(text) - bb[1]), ch, font=f, fill=fg)
    save(img, name)


def _runner(d, cx, cy, fg):
    # 오른쪽으로 달리는 사람 (몸통이 앞으로 기울고 팔다리를 크게 벌림)
    w = 20
    d.ellipse([cx + 8, cy - 92, cx + 56, cy - 44], fill=fg)
    d.line([(cx + 22, cy - 38), (cx - 8, cy + 30)], fill=fg, width=w + 4)                        # 몸통
    d.line([(cx + 16, cy - 26), (cx + 52, cy - 2), (cx + 78, cy - 30)], fill=fg, width=w, joint="curve")   # 앞팔
    d.line([(cx + 16, cy - 26), (cx - 22, cy - 18), (cx - 44, cy + 6)], fill=fg, width=w, joint="curve")  # 뒷팔
    d.line([(cx - 8, cy + 30), (cx + 36, cy + 52), (cx + 30, cy + 98)], fill=fg, width=w, joint="curve")  # 앞다리
    d.line([(cx - 8, cy + 30), (cx - 30, cy + 74), (cx - 78, cy + 80)], fill=fg, width=w, joint="curve")  # 뒷다리


def exit_sign():
    # 비상구 표시: 사람과 화살표가 같은 방향 (→), 반대 방향(←), 문 위에 다는 화살표 없는 문 그림
    W, H = 512, 256
    fg = (250, 255, 250)

    def base():
        img = Image.new("RGB", (W, H), (20, 190, 90))
        d = ImageDraw.Draw(img)
        d.rectangle([12, 12, W - 12, H - 12], outline=(240, 255, 240), width=8)
        return img, d

    img, d = base()
    _runner(d, 150, 132, fg)
    d.rectangle([262, 114, 372, 148], fill=fg)
    d.polygon([(368, 84), (452, 131), (368, 178)], fill=fg)
    save(img, "sign_exit.jpg")
    save(ImageOps.mirror(img), "sign_exit_l.jpg")
    img, d = base()
    d.rectangle([318, 46, 440, 216], outline=fg, width=12)       # 열린 문
    d.polygon([(330, 58), (392, 76), (392, 226), (330, 206)], fill=fg)
    _runner(d, 190, 132, fg)
    save(img, "sign_exit_door.jpg")


def kiosk_screens():
    W, H = 1024, 512
    img = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(img)
    titles = [("PHOTO TICKET", (60, 110, 220)), ("티켓 발권", (220, 40, 50)), ("바로팝콘", (230, 70, 60)), ("배터리 대여", (40, 170, 120))]
    fw = W // 4
    for i, (t, c) in enumerate(titles):
        x = i * fw
        d.rectangle([x + 6, 6, x + fw - 6, H - 6], fill=(245, 245, 248))
        d.rectangle([x + 6, 6, x + fw - 6, 90], fill=c)
        d.text((x + 20, 24), t, font=font("malgunbd.ttf", 34), fill=(255, 255, 255))
        for k in range(4):
            d.rounded_rectangle([x + 22, 120 + k * 92, x + fw - 22, 190 + k * 92], radius=10, fill=(225, 228, 236))
    save(img, "kiosk_screens.jpg")


def posters():
    # 오리지널 가상 영화 포스터 6장 (1장 512x768) → 아틀라스 3x2
    titles = [
        ("방과후 티타임", "LIVE IN HONGDAE", (255, 140, 180), (40, 20, 60)),
        ("푸른 밤의 베이스", "BLUE NIGHT BASS", (90, 150, 255), (10, 20, 50)),
        ("드럼 앤 선샤인", "DRUM & SUNSHINE", (255, 210, 60), (70, 30, 10)),
        ("홍차와 건반", "TEA & KEYS", (200, 160, 255), (30, 20, 50)),
        ("고양이 귀 기타", "NEKO GUITAR", (255, 90, 90), (40, 10, 20)),
        ("광음 페스티벌", "SOUND FESTIVAL", (120, 240, 200), (5, 30, 30)),
    ]
    W, H = 512, 768
    atlas = Image.new("RGB", (W * 3, H * 2))
    for i, (kt, et, c1, c2) in enumerate(titles):
        img = Image.new("RGB", (W, H), c2)
        d = ImageDraw.Draw(img)
        for y in range(H):
            t = y / H
            d.line([0, y, W, y], fill=tuple(int(c2[k] * (1 - t) + c1[k] * t * 0.55) for k in range(3)))
        rr = random.Random(100 + i)
        for _ in range(16):
            x, y, r = rr.randint(0, W), rr.randint(60, 520), rr.randint(20, 120)
            d.ellipse([x - r, y - r, x + r, y + r], outline=c1, width=rr.randint(2, 8))
        d.text((30, 560), kt, font=font("malgunbd.ttf", 62), fill=(255, 255, 255))
        d.text((32, 650), et, font=font("arialbd.ttf", 34), fill=c1)
        d.text((32, 712), "COMING SOON  |  LOTTE CINEMA", font=font("arialbd.ttf", 20), fill=(220, 220, 220))
        atlas.paste(img, ((i % 3) * W, (i // 3) * H))
    save(atlas, "posters.jpg")


def city_night():
    # 창밖 홍대 야경 (원경)
    W, H = 2048, 1024
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line([0, y, W, y], fill=(int(20 + 50 * t), int(26 + 40 * t), int(60 + 50 * t)))
    rr = random.Random(55)
    for layer, (lo, hi, col) in enumerate(((300, 620, (30, 34, 52)), (450, 820, (22, 24, 36)))):
        x = 0
        while x < W:
            w = rr.randint(60, 200)
            top = rr.randint(lo, hi)
            d.rectangle([x, top, x + w, H], fill=col)
            for wy in range(top + 12, H - 10, 22):
                for wx in range(x + 8, x + w - 10, 18):
                    if rr.random() < 0.45:
                        c = rr.choice([(255, 220, 150), (240, 240, 255), (255, 200, 120), (180, 220, 255)])
                        d.rectangle([wx, wy, wx + 8, wy + 10], fill=c)
            if rr.random() < 0.3:
                c = rr.choice([(255, 60, 120), (60, 200, 255), (255, 200, 40)])
                d.rectangle([x + 10, top + 20, x + w - 10, top + 60], fill=c)
            x += w + rr.randint(0, 20)
    img = img.filter(ImageFilter.GaussianBlur(1.0))
    save(img, "city_night.jpg")


def baby_seat_sign():
    text_sign("sign_babyseat.png", "베이비시트  Baby Seat", (240, 240, 240, 255), None, 1024, 128, size=70)


def theater_number():
    text_sign("sign_4.png", "4관", (255, 255, 255, 255), None, 512, 256, size=170)
    text_sign("sign_5.png", "5관 ↑", (255, 255, 255, 255), None, 512, 256, size=150)
    text_sign("sign_5_door.png", "5관", (255, 255, 255, 255), None, 512, 256, size=170)
    text_sign("sign_6.png", "6관", (255, 255, 255, 255), None, 512, 256, size=170)
    text_sign("sign_wc.png", "화장실  RESTROOM", (255, 255, 255, 255), None, 1024, 160, size=80)
    text_sign("sign_hydrant.png", "소화전", (255, 255, 255), (200, 20, 20), 512, 256, size=120)
    vertical_text("sign_kwangeum.png", "광음시네마", (25, 25, 25, 255))


def glow_cone():
    # 벽 업라이트 빛 번짐 (아래 좁고 위로 퍼지는 따뜻한 원뿔)
    W, H = 256, 512
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = img.load()
    for y in range(H):
        t = 1 - y / H  # 아래(0) → 위(1)
        half = 0.08 + 0.42 * t
        for x in range(W):
            dx = abs(x / W - 0.5) / half
            if dx < 1:
                a = (1 - dx ** 2) * (1 - t) ** 0.6 * (0.25 + 0.75 * min(1, y / (H * 0.08)))
                a = max(0.0, min(1.0, a)) * (1 - max(0, (y - H * 0.95) / (H * 0.05)))
                px[x, y] = (255, 196, 120, int(255 * a))
    save(img.filter(ImageFilter.GaussianBlur(3)), "glow_cone.png")


if __name__ == "__main__":
    glow_cone()
    wood_tile(); dark_tile(); carpet(); carpet_dark()
    stone_panel(); theater_wall(); graffiti()
    seat_fabric(); seat_logo(); wood()
    sweet_sign(); menu_boards(); lotte_sign(); exit_sign(); kiosk_screens(); posters(); city_night()
    baby_seat_sign(); theater_number(); down_sign()
    kiosk_atlas(); box_office_signs(); ad_screens()
