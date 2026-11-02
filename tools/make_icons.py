# Web 版のアイコン（icon-180/192/512.png）を作る。絵は Android 版の tools/make_icon.py と同じ（紫の地に写真 2 枚と金色の「超」）。
# iPhone・iPad は角を自分で丸めるので、四角いまま画面いっぱいに描く。
import os, sys
sys.path.insert(0, r'C:\esp32\android\free_album\tools')
import make_icon as m
from PIL import Image

def build():
    S, U = m.S, m.U
    fg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    for (w, h, ph, dc, a, cx, cy) in [(25, 22, (0x8E, 0xC5, 0xE8, 255), m.mountains, 14, 44, 44),
                                      (25, 22, (0xF4, 0xB6, 0xC8, 255), m.sun, -10, 64, 42)]:
        im, pos = m.card(w, h, ph, dc, a, cx, cy)
        shadow = Image.new('RGBA', im.size, (0, 0, 0, 0))
        shadow.paste((0, 0, 0, 90), mask=im.split()[3])
        fg.alpha_composite(shadow, (pos[0] + int(0.8 * U), pos[1] + int(1.2 * U)))
        fg.alpha_composite(im, pos)
    from PIL import ImageDraw, ImageFont
    font = ImageFont.truetype(r'C:\Windows\Fonts\YuGothB.ttc', int(33 * U))
    d = ImageDraw.Draw(fg)
    bb = d.textbbox((0, 0), '超', font=font)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    d.text((S / 2 - tw / 2 - bb[0], 64 * U - th / 2 - bb[1]), '超', font=font, fill=m.GOLD,
           stroke_width=int(2.6 * U), stroke_fill=(0x2A, 0x22, 0x34, 255))
    full = Image.new('RGBA', (S, S), m.BG)
    full.alpha_composite(fg)
    c = int(18 * U)
    return full.crop((c, c, S - c, S - c)).convert('RGB')

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    im = build()
    for px in (180, 192, 512):
        im.resize((px, px), Image.LANCZOS).save(os.path.join(out, f'icon-{px}.png'))
