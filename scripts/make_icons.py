from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[1] / "icons"
ASSETS = Path(__file__).resolve().parents[1] / "assets"
ASSETS.mkdir(exist_ok=True)
OUT_DIR.mkdir(exist_ok=True)

SIZE = 512
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

cx, cy = 236, 220
outer_r = 150
inner_r = 108
ring_color = (32, 36, 42, 255)
lens_top = (80, 220, 210, 255)
lens_bot = (40, 170, 185, 255)
highlight = (255, 255, 255, 170)
handle_color = (32, 36, 42, 255)

hx0, hy0 = cx + int(outer_r * 0.55), cy + int(outer_r * 0.55)
hx1, hy1 = hx0 + 145, hy0 + 145

# Soft shadow
shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.ellipse(
    (cx - outer_r + 14, cy - outer_r + 22, cx + outer_r + 14, cy + outer_r + 22),
    fill=(0, 0, 0, 55),
)
sd.line([(hx0, hy0), (hx1, hy1)], fill=(0, 0, 0, 45), width=52)
shadow = shadow.filter(ImageFilter.GaussianBlur(18))
img = Image.alpha_composite(img, shadow)

draw = ImageDraw.Draw(img)

# Handle
draw.line([(hx0, hy0), (hx1, hy1)], fill=handle_color, width=48)
draw.ellipse((hx1 - 24, hy1 - 24, hx1 + 24, hy1 + 24), fill=handle_color)
draw.ellipse((hx0 - 20, hy0 - 20, hx0 + 20, hy0 + 20), fill=handle_color)

# Outer ring
draw.ellipse((cx - outer_r, cy - outer_r, cx + outer_r, cy + outer_r), fill=ring_color)

# Lens gradient
grad = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
gd = ImageDraw.Draw(grad)
for i in range(inner_r * 2):
    t = i / (inner_r * 2)
    r = int(lens_top[0] * (1 - t) + lens_bot[0] * t)
    g = int(lens_top[1] * (1 - t) + lens_bot[1] * t)
    b = int(lens_top[2] * (1 - t) + lens_bot[2] * t)
    y = cy - inner_r + i
    dy = y - cy
    if abs(dy) >= inner_r:
        continue
    half = int((inner_r**2 - dy**2) ** 0.5)
    gd.line([(cx - half, y), (cx + half, y)], fill=(r, g, b, 255))

mask = Image.new("L", (SIZE, SIZE), 0)
md = ImageDraw.Draw(mask)
md.ellipse((cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r), fill=255)
grad.putalpha(mask)
img = Image.alpha_composite(img, grad)

# Specular highlight
hl = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
hd = ImageDraw.Draw(hl)
arc_box = (cx - inner_r + 18, cy - inner_r + 14, cx + inner_r - 40, cy + 20)
hd.arc(arc_box, start=200, end=300, fill=highlight, width=14)
hl = hl.filter(ImageFilter.GaussianBlur(1.2))
img = Image.alpha_composite(img, hl)

draw = ImageDraw.Draw(img)
draw.ellipse(
    (cx - outer_r + 6, cy - outer_r + 6, cx + outer_r - 6, cy + outer_r - 6),
    outline=(70, 78, 88, 90),
    width=3,
)

master_path = ASSETS / "extension-icon-loupe-transparent.png"
img.save(master_path, "PNG")
print(f"master: {master_path} mode={img.mode} size={img.size}")
print(f"corner pixel RGBA: {img.getpixel((0, 0))}")

for size in (16, 32, 48, 128):
    resized = img.resize((size, size), Image.Resampling.LANCZOS)
    out = OUT_DIR / f"icon{size}.png"
    resized.save(out, "PNG")
    print(f"{out.name}: {resized.size} corner={resized.getpixel((0, 0))}")

print("done")
