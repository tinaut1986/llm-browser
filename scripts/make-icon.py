#!/usr/bin/env python3
"""Draws build/icon.png (1024), icon.ico and icon.icns. Needs Pillow."""
from PIL import Image, ImageDraw, ImageFilter
import os

S = 4096  # draw big, downsample for clean edges
def px(v): return int(v * S / 1024)

img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# App tile: same dark palette as ui.html
d.rounded_rectangle([px(32), px(32), px(992), px(992)], px(200), fill='#1e1f24')

# Browser window
d.rounded_rectangle([px(132), px(222), px(892), px(802)], px(56), fill='#3a3d46')
# tab strip
d.rounded_rectangle([px(132), px(222), px(892), px(352)], px(56), fill='#2a2c33')
d.rectangle([px(132), px(300), px(892), px(352)], fill='#2a2c33')
d.rounded_rectangle([px(176), px(262), px(436), px(352)], px(30), fill='#3a3d46')
d.rectangle([px(176), px(320), px(436), px(352)], fill='#3a3d46')
# address bar pill
d.rectangle([px(132), px(352), px(892), px(452)], fill='#3a3d46')
d.rounded_rectangle([px(232), px(372), px(852), px(432)], px(30), fill='#1e1f24')
# back-button dot
d.ellipse([px(158), px(388), px(186), px(416)], fill='#8a8d98')
# page content: abstract text lines
for y, w in ((520, 520), (580, 400), (640, 460)):
    d.rounded_rectangle([px(190), px(y), px(190 + w), px(y + 26)], px(13), fill='#555966')

# Virtual mouse: the red circle the model moves, plus a pointer arrow
glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
g = ImageDraw.Draw(glow)
g.ellipse([px(520), px(440), px(900), px(820)], fill=(255, 70, 70, 120))
glow = glow.filter(ImageFilter.GaussianBlur(px(30)))
img = Image.alpha_composite(img, glow)
d = ImageDraw.Draw(img)
d.ellipse([px(560), px(480), px(860), px(780)], fill=(255, 70, 70, 70), outline='#ff4646', width=px(18))
arrow = [(640, 520), (640, 800), (710, 735), (760, 850), (815, 825), (765, 712), (860, 712)]
d.polygon([(px(x), px(y)) for x, y in arrow], fill='#ffffff', outline='#1e1f24')
d.line([(px(x), px(y)) for x, y in arrow + [arrow[0]]], fill='#1e1f24', width=px(14), joint='curve')

out = os.path.join(os.path.dirname(__file__), '..', 'build')
os.makedirs(out, exist_ok=True)
base = img.resize((1024, 1024), Image.LANCZOS)
base.save(os.path.join(out, 'icon.png'))
base.save(os.path.join(out, 'icon.ico'), sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
base.save(os.path.join(out, 'icon.icns'))
