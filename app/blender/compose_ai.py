# Codex(gpt-6.1-sol)로 생성한 이미지를 게임용 텍스처로 합성
#   textures_ai/*.png → textures_ai/{menu_boards_ai.png, wall_stone_ai.jpg, ...}
#                     → ../client/assets/textures/{sign4_bg.jpg, led_idle.jpg, led_idle2.jpg}
import os

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
AI = os.path.join(HERE, "textures_ai")
CLIENT_TEX = os.path.normpath(os.path.join(HERE, "..", "client", "assets", "textures"))
os.makedirs(CLIENT_TEX, exist_ok=True)
F = "C:/Windows/Fonts/"


def font(n, s):
    return ImageFont.truetype(F + n, s)


def ai(name):
    return Image.open(os.path.join(AI, name)).convert("RGB")


def fit(im, w, h):
    # 비율 유지 cover 크롭
    r = max(w / im.width, h / im.height)
    im = im.resize((int(im.width * r + 0.5), int(im.height * r + 0.5)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def shadow_text(d, xy, text, f, fill, sw=4):
    d.text(xy, text, font=f, fill=fill, stroke_width=sw, stroke_fill=(0, 0, 0))


def menu_boards():
    items = [
        ("더블맥주콤보", "팝콘(L) 1 + 맥주 2", "17,000원", "food_1.png", (40, 40, 40)),
        ("방과후 콤보", "팝콘(M) + 음료 2 + 케이크", "15,500원", "food_2.png", (180, 40, 90)),
        ("스낵 플래터", "카라멜팝콘 + 오징어 + 나초", "13,000원", "food_3.png", (200, 110, 20)),
        ("더블콤보", "팝콘 2 + 음료 2  사이즈업 +1,000", "19,000원", "food_4.png", (200, 30, 30)),
    ]
    W, H = 2048, 320
    board = Image.new("RGB", (W, H), (8, 8, 10))
    pw = W // 4
    for i, (t, s, price, img, col) in enumerate(items):
        x = i * pw
        panel = Image.new("RGB", (pw - 16, H - 16), (244, 242, 238))
        photo = fit(ai(img), 250, H - 16)
        panel.paste(photo, (pw - 16 - 250, 0))
        fade = Image.new("L", (80, H - 16))
        for k in range(80):
            ImageDraw.Draw(fade).line([k, 0, k, H], fill=int(255 * (1 - k / 80)))
        panel.paste(Image.new("RGB", (80, H - 16), (244, 242, 238)), (pw - 16 - 250, 0), fade)
        d = ImageDraw.Draw(panel)
        d.text((22, 26), t, font=font("malgunbd.ttf", 44), fill=col)
        d.text((22, 98), s, font=font("malgun.ttf", 22), fill=(90, 90, 90))
        d.rounded_rectangle([20, 200, 190, 262], radius=12, fill=col)
        d.text((34, 208), price, font=font("malgunbd.ttf", 34), fill=(255, 255, 255))
        board.paste(panel, (x + 8, 8))
    board.save(os.path.join(AI, "menu_boards_ai.png"))


def wall_stone():
    base = fit(ai("lobby_stone_tile.png"), 1024, 1024)
    base = ImageEnhance.Brightness(base).enhance(0.62)
    base = ImageEnhance.Color(base).enhance(0.5)
    d = ImageDraw.Draw(base)
    S = 1024
    for row in range(4):
        y = row * S // 4
        shift = (S // 4) if row % 2 else 0
        d.line([0, y, S, y], fill=(62, 62, 62), width=4)
        for col in range(-1, 3):
            x = col * S // 2 + shift
            d.line([x, y, x, y + S // 4], fill=(62, 62, 62), width=4)
            for cx, cy in ((x + 40, y + 40), (x + S // 2 - 40, y + S // 4 - 40)):
                d.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], fill=(170, 170, 168))
    base = base.filter(ImageFilter.GaussianBlur(0.4))
    base.save(os.path.join(AI, "wall_stone_ai.jpg"), quality=88)


def resize_tiles():
    for src, dst, size in (("carpet_tile.png", "carpet_ai.jpg", 1024), ("theater_wall_tile.png", "theater_wall_ai.jpg", 1024)):
        fit(ai(src), size, size).save(os.path.join(AI, dst), quality=88)
    fit(ai("city_night.png"), 2048, 1024).save(os.path.join(AI, "city_night_ai.jpg"), quality=86)
    fit(ai("graffiti.png"), 2048, 1024).save(os.path.join(AI, "graffiti_ai.jpg"), quality=88)


def client_textures():
    fit(ai("sign4_bg.png"), 2048, 582).save(os.path.join(CLIENT_TEX, "sign4_bg.jpg"), quality=88)
    fit(ai("led_idle.png"), 1920, 1080).save(os.path.join(CLIENT_TEX, "led_idle.jpg"), quality=88)
    fit(ai("led_idle2.png"), 1920, 1080).save(os.path.join(CLIENT_TEX, "led_idle2.jpg"), quality=88)


if __name__ == "__main__":
    menu_boards(); wall_stone(); resize_tiles(); client_textures()
    print("composed")
