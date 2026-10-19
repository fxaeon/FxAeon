"""Build the offline reference without bundling fonts or fetching resources."""
from pathlib import Path
import base64
import mimetypes

ROOT = Path(__file__).resolve().parent

def build():
    html = (ROOT / 'index.html').read_text()
    html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>' + (ROOT / 'styles.css').read_text() + '</style>')
    for name in ['model.js', 'app.js', 'dialog-focus.js']:
        source = (ROOT / name).read_text().replace('</script', '<\\/script')
        html = html.replace(f'<script src="{name}"></script>', '<script>' + source + '</script>')
    assets = {}
    for path in (ROOT / 'assets').iterdir():
        if path.suffix not in ['.png', '.svg']: continue
        mime = mimetypes.guess_type(path.name)[0]
        assets[path.name] = f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode()
    html = html.replace('src="assets/brand.svg"', 'src="' + assets['brand.svg'] + '"')
    # Replace the dynamic icon source expression with its bundled data URI.
    import json
    html = html.replace('src="assets/${tokenFiles[s] || tokenFiles.ETH}"', 'src="${(' + json.dumps(assets) + ')[tokenFiles[s] || tokenFiles.ETH]}"')
    path = ROOT / 'FxAeon-journeys.html'
    path.write_text(html)
    return path

if __name__ == '__main__':
    print(build())
