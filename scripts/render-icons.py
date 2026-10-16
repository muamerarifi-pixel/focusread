from playwright.sync_api import sync_playwright
import pathlib
base=pathlib.Path(__file__).resolve().parent.parent/'public'/'icons'
anysvg=(base/'icon.svg').read_text(); masksvg=(pathlib.Path(__file__).parent/'maskable.svg').read_text()
jobs=[('icon-192.png',192,anysvg),('icon-512.png',512,anysvg),('favicon-32.png',32,anysvg),('maskable-192.png',192,masksvg),('maskable-512.png',512,masksvg),('apple-touch-icon.png',180,masksvg)]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    for name,size,svg in jobs:
        body=svg.replace('<svg ',f'<svg width="{size}" height="{size}" ',1)
        pg.set_viewport_size({'width':size,'height':size})
        pg.set_content(f'<html><body style="margin:0;background:transparent">{body}</body></html>')
        pg.screenshot(path=str(base/name), omit_background=True, clip={'x':0,'y':0,'width':size,'height':size})
    b.close()
print('icons rendered')
