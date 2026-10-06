"""Make the demo's sample docket photos (clearly marked SAMPLE).

Each one is drawn as a plain paper document, then made to look like a yard photo:
crooked, dim with uneven light, creased, on a dark background. Run from the repo root:
    python3 scripts/samples/make_dockets.py
Writes src/lib/demo/samples/*.jpg (inlined into the demo build) and a harder\ntest photo in scripts/e2e/fixtures/.
"""
import math, os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import numpy as np

OUT = os.path.join('src', 'lib', 'demo', 'samples')
SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
W, H = 1100, 1400


def f(path, size):
    return ImageFont.truetype(path, size)


def paper(lines):
    """lines: list of (text, font, x, gap) drawn top to bottom."""
    img = Image.new('L', (W, H), 247)
    d = ImageDraw.Draw(img)
    y = 70
    for item in lines:
        if item == 'rule':
            d.line((70, y + 8, W - 70, y + 8), fill=60, width=3); y += 30; continue
        text, font, x, gap = item
        d.text((x, y), text, fill=25, font=font)
        y += gap
    # SAMPLE banner across the foot so nobody mistakes it for a real document
    d.rectangle((0, H - 120, W, H), fill=225)
    d.text((70, H - 95), 'SAMPLE FOR AGRI-IT DEMO. NOT A REAL DOCUMENT.', fill=90, font=f(BOLD, 34))
    return img


def yard_photo(doc, angle, dim, crease, seed):
    rnd = random.Random(seed)
    a = np.asarray(doc).astype(np.float32)
    h, w = a.shape
    if crease:  # fold lines: a dark crease with a light edge either side
        for (x0, y0, x1, y1) in crease:
            m = Image.new('L', (w, h), 0)
            ImageDraw.Draw(m).line((x0, y0, x1, y1), fill=255, width=7)
            m = np.asarray(m.filter(ImageFilter.GaussianBlur(6))).astype(np.float32) / 255
            a = a * (1 - 0.35 * m)
    # uneven light: bright top-left falling to dim bottom-right, then overall dimming
    yy, xx = np.mgrid[0:h, 0:w]
    grad = 1 - 0.45 * ((xx / w) * 0.6 + (yy / h) * 0.4)
    a = a * grad * dim
    a += np.random.default_rng(seed).normal(0, 6, a.shape)  # sensor noise
    a = np.clip(a, 0, 255).astype(np.uint8)
    page = Image.fromarray(a).convert('RGB')
    tint = Image.new('RGB', page.size, (255, 236, 205))  # warm shed light
    page = Image.blend(page, Image.composite(tint, page, Image.new('L', page.size, 60)), 0.5)
    bg = Image.new('RGB', (w + 260, h + 260), (58, 52, 45))
    bgd = ImageDraw.Draw(bg)
    for _ in range(400):  # rough concrete
        x, y = rnd.randint(0, bg.width), rnd.randint(0, bg.height)
        c = rnd.randint(40, 80)
        bgd.ellipse((x, y, x + 4, y + 4), fill=(c, c - 4, c - 8))
    rot = page.rotate(angle, expand=True, resample=Image.BICUBIC, fillcolor=(0, 0, 0))
    mask = Image.new('L', page.size, 255).rotate(angle, expand=True)
    bg.paste(rot, ((bg.width - rot.width) // 2, (bg.height - rot.height) // 2), mask)
    bg = bg.filter(ImageFilter.GaussianBlur(0.8))  # slight hand shake
    bg.thumbnail((1200, 1600))
    return bg


def main():
    os.makedirs(OUT, exist_ok=True)
    H1, H2, B, M = f(BOLD, 52), f(BOLD, 34), f(SANS, 30), f(MONO, 30)

    docket = paper([
        ('Tirlán FarmLife', H1, 70, 70), ('Bulk Feed Delivery Docket', H2, 70, 60), 'rule',
        ('Docket No: D-482917', B, 70, 46), ('Date: 05/10/2026', B, 70, 46),
        ('Customer: Glenview Farm, Co. Tipperary', B, 70, 46), ('Account: 104477', B, 70, 60), 'rule',
        ('Product                  Qty    Unit', M, 70, 46),
        ('DAIRY NUT 16% CP         3.00   T', M, 70, 46),
        ('Price per tonne         392.00', M, 70, 46),
        ('Value               EUR 1,176.00', M, 70, 60), 'rule',
        ('Haulier: J. Ryan   Reg: 191-T-2214', B, 70, 46), ('Received by: ______________', B, 70, 46),
    ])
    vet = paper([
        ('Suir Valley Veterinary Clinic', H1, 70, 66), ('Main St, Cahir, Co. Tipperary', B, 70, 60), 'rule',
        ('RECEIPT', H2, 70, 56), ('Invoice No: 20871', B, 70, 46), ('Date: 02/10/2026', B, 70, 46),
        ('Client: Glenview Farm', B, 70, 60), 'rule',
        ('Call-out fee                  45.00', M, 70, 46),
        ('Calving assistance            95.00', M, 70, 46),
        ('Medicines                     38.50', M, 70, 46),
        ('Subtotal                     178.50', M, 70, 46),
        ('VAT @ 13.5%                   24.10', M, 70, 46),
        ('TOTAL                    EUR 202.60', M, 70, 60), 'rule',
        ('Paid by card. Thank you.', B, 70, 46),
    ])
    invoice = paper([
        ('Dairygold Agri Business', H1, 70, 66), ('Sales Invoice', H2, 70, 60), 'rule',
        ('Invoice No: INV-2026-118834', B, 70, 46), ('Invoice Date: 29/09/2026', B, 70, 46),
        ('Account: GLV-2231   Glenview Farm', B, 70, 60), 'rule',
        ('Description        Qty   Rate     Amount', M, 70, 46),
        ('Dairy Nut 16% Bulk 2.50t 388.00   970.00', M, 70, 46),
        ('Net                              970.00', M, 70, 46),
        ('VAT 0%                             0.00', M, 70, 46),
        ('Total due                    EUR 970.00', M, 70, 60), 'rule',
        ('Payment due within 30 days.', B, 70, 46),
    ])
    yard_photo(docket, angle=-4.5, dim=0.72, crease=None, seed=1).save(os.path.join(OUT, 'feed-docket.jpg'), quality=70)
    yard_photo(vet, angle=2.5, dim=0.85, crease=[(0, 640, 1100, 700), (520, 0, 560, 1400)], seed=2).save(os.path.join(OUT, 'vet-receipt.jpg'), quality=70)
    yard_photo(invoice, angle=-1.5, dim=0.6, crease=[(0, 820, 1100, 790)], seed=3).save(os.path.join(OUT, 'supplier-invoice.jpg'), quality=70)
    # Harder test photos for the browser test (not shipped in the demo)
    fx = os.path.join('scripts', 'e2e', 'fixtures')
    os.makedirs(fx, exist_ok=True)
    yard_photo(docket, angle=8, dim=0.42, crease=[(0, 500, 1100, 560), (300, 0, 340, 1400)], seed=4).save(os.path.join(fx, 'very-dim-docket.jpg'), quality=60)
    for n in os.listdir(OUT):
        print(n, os.path.getsize(os.path.join(OUT, n)))


if __name__ == '__main__':
    main()
