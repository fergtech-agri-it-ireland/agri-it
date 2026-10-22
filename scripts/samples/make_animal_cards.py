"""Make test photos of a made-up animal identity card (clearly marked SAMPLE) for scripts/e2e/animals.py.

These are NOT the real card layout. Agri-It's reader looks for the tag number by its shape
(372 and 12 digits, or IE and 12 digits), not by where it sits, so these only prove that the
reader finds numbers in a photo that is crooked and dim. Run from the repo root:
    python3 scripts/samples/make_animal_cards.py
Writes scripts/e2e/fixtures/animal-card-*.jpg
"""
import os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import numpy as np

OUT = os.path.join('scripts', 'e2e', 'fixtures')
SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
W, H = 1500, 1000


def font(path, size):
    return ImageFont.truetype(path, size)


def card(rows):
    img = Image.new('RGB', (W, H), (205, 222, 245))
    d = ImageDraw.Draw(img)
    d.rectangle((30, 30, W - 30, H - 30), outline=(40, 70, 130), width=5)
    y = 70
    for text, big, gap in rows:
        d.text((80, y), text, fill=(20, 30, 60), font=font(BOLD if big else SANS, 64 if big else 44))
        y += gap
    d.text((80, H - 110), 'SAMPLE FOR AGRI-IT TESTS. NOT A REAL CARD.', fill=(90, 100, 130), font=font(BOLD, 34))
    return img


def photo(img, angle, dim, seed):
    random.seed(seed); np.random.seed(seed)
    bg = Image.new('RGB', (W + 300, H + 300), (35, 38, 34))
    img = img.rotate(angle, expand=True, resample=Image.BICUBIC, fillcolor=(35, 38, 34))
    bg.paste(img, ((bg.width - img.width) // 2, (bg.height - img.height) // 2))
    a = np.asarray(bg).astype(np.float32)
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    light = 1.0 - dim * (0.5 * xx / w + 0.35 * yy / h)
    a = a * light[..., None] + np.random.normal(0, 4, a.shape)
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    return out.resize((1500, int(1500 * out.height / out.width)))


def save(name, img):
    os.makedirs(OUT, exist_ok=True)
    img.save(os.path.join(OUT, name), quality=88)
    print('wrote', name)


save('animal-card-clean.jpg', photo(card([
    ('ANIMAL IDENTITY CARD', True, 110),
    ('Tag number', False, 70),
    ('372 12 34567 8 1234', True, 130),
    ('Breed: AA    Sex: F', False, 70),
    ('Date of birth: 05/02/2024', False, 70),
]), 3, 0.25, 1))
save('animal-card-two.jpg', photo(card([
    ('ANIMAL IDENTITY CARD', True, 110),
    ('372 12 34567 8 1234', True, 110),
    ('Dam: 372 12 34567 2 0456', False, 80),
    ('Breed: HE    Sex: M', False, 70),
]), -4, 0.3, 2))
save('animal-card-old.jpg', photo(card([
    ('ANIMAL IDENTITY CARD', True, 110),
    ('Tag number', False, 70),
    ('IE 04 12345 6 7890', True, 130),
    ('Breed: LM    Sex: F', False, 70),
]), 2, 0.2, 3))
save('animal-card-none.jpg', photo(card([
    ('ANIMAL IDENTITY CARD', True, 110),
    ('Herd number 1234567', False, 70),
    ('Phone 087 123 4567', False, 70),
]), 0, 0.2, 4))
