#!/usr/bin/env python3
"""
Regenerate all transparent RGBA PNGs from adult_*.jpg source portraits.
Run before publish to guarantee webroot always has correct transparent icons.
"""
from PIL import Image
import numpy as np
from collections import deque
import os, shutil, sys

def remove_background(input_path, output_path, tolerance=35, top_padding=0.10):
    img = Image.open(input_path).convert('RGBA')
    data = np.array(img)
    corners = [data[5,5,:3], data[5,-5,:3], data[-5,5,:3], data[-5,-5,:3]]
    bg_color = np.mean(corners, axis=0)
    rgb = data[:,:,:3].astype(float)
    diff = np.sqrt(np.sum((rgb - bg_color)**2, axis=2))
    bg_mask = diff < tolerance
    h, w = data.shape[:2]
    visited = np.zeros((h, w), dtype=bool)
    queue = deque()
    for y in range(h):
        for x in [0, w-1]:
            if not visited[y,x] and bg_mask[y,x]: queue.append((y,x)); visited[y,x] = True
    for x in range(w):
        for y in [0, h-1]:
            if not visited[y,x] and bg_mask[y,x]: queue.append((y,x)); visited[y,x] = True
    while queue:
        y, x = queue.popleft()
        for dy, dx in [(-1,0),(1,0),(0,-1),(0,1)]:
            ny, nx = y+dy, x+dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny,nx] and bg_mask[ny,nx]:
                visited[ny,nx] = True; queue.append((ny,nx))
    data[visited, 3] = 0
    # Add transparent padding at the top so heads are never clipped in tiles
    pad_px = int(h * top_padding)
    pad = np.zeros((pad_px, w, 4), dtype=np.uint8)
    padded = np.concatenate([pad, data], axis=0)
    Image.fromarray(padded).save(output_path, 'PNG')

src_base = '/home/deploy/agents'
web_base = '/var/www/goosielabs/agents'
errors = []

for goose in sorted(os.listdir(src_base)):
    adult = f'{src_base}/{goose}/adult_{goose}.jpg'
    plain = f'{src_base}/{goose}/{goose}.jpg'
    src = adult if os.path.exists(adult) else plain if os.path.exists(plain) else None
    if not src:
        continue
    dst_src = f'{src_base}/{goose}/{goose}.png'
    dst_web = f'{web_base}/{goose}/{goose}.png'
    try:
        remove_background(src, dst_src)
        os.makedirs(f'{web_base}/{goose}', exist_ok=True)
        shutil.copy2(dst_src, dst_web)
    except Exception as e:
        errors.append(f'{goose}: {e}')

# Perry
try:
    remove_background(
        '/var/www/goosielabs/perry/perry-goose.jpg',
        '/var/www/goosielabs/perry/perry-goose.png'
    )
except Exception as e:
    errors.append(f'perry: {e}')

if errors:
    print('ERRORS:', errors, file=sys.stderr)
    sys.exit(1)
