#!/usr/bin/env python3
"""
Converteert juridischadvies.md naar juridischadvies.html per app.
Zet het in dist/ (direct bereikbaar) en public/ (overleeft npm run build).
Gebruik: python3 generate-juridisch-html.py [appnaam]
"""

import os, re, sys, glob

APPS_DIR = "/var/www/goosielabs/apps"

def md_to_html(text):
    lines = text.split("\n")
    out = []
    in_list = False
    in_blockquote = False

    def close_list():
        nonlocal in_list
        if in_list:
            out.append("</ul>")
            in_list = False

    def close_blockquote():
        nonlocal in_blockquote
        if in_blockquote:
            out.append("</blockquote>")
            in_blockquote = False

    def inline(s):
        s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
        s = re.sub(r"\*(.+?)\*", r"<em>\1</em>", s)
        s = re.sub(r"`(.+?)`", r"<code>\1</code>", s)
        s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)
        return s

    for line in lines:
        # Horizontal rule
        if re.match(r"^-{3,}$", line):
            close_list()
            close_blockquote()
            out.append("<hr>")
            continue

        # Headings
        m = re.match(r"^(#{1,4})\s+(.+)", line)
        if m:
            close_list()
            close_blockquote()
            lvl = len(m.group(1))
            out.append(f"<h{lvl}>{inline(m.group(2))}</h{lvl}>")
            continue

        # Blockquote
        m = re.match(r"^>\s*(.*)", line)
        if m:
            close_list()
            if not in_blockquote:
                out.append("<blockquote>")
                in_blockquote = True
            out.append(f"<p>{inline(m.group(1))}</p>")
            continue

        # Checklist item
        m = re.match(r"^- \[([ xX])\]\s+(.*)", line)
        if m:
            close_blockquote()
            if not in_list:
                out.append('<ul class="checklist">')
                in_list = True
            checked = m.group(1).lower() == "x"
            cls = ' class="done"' if checked else ""
            cb = "☑" if checked else "☐"
            out.append(f'  <li{cls}><span class="cb">{cb}</span> {inline(m.group(2))}</li>')
            continue

        # Regular list item
        m = re.match(r"^[-*]\s+(.*)", line)
        if m:
            close_blockquote()
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"  <li>{inline(m.group(1))}</li>")
            continue

        # Empty line
        if line.strip() == "":
            close_list()
            close_blockquote()
            out.append("")
            continue

        # Normal paragraph line
        close_list()
        close_blockquote()
        out.append(f"<p>{inline(line)}</p>")

    close_list()
    close_blockquote()
    return "\n".join(out)


def generate(app_name):
    app_dir = os.path.join(APPS_DIR, app_name)
    md_path = os.path.join(app_dir, "juridischadvies.md")

    if not os.path.exists(md_path):
        print(f"  ⏭  {app_name} — geen juridischadvies.md, overgeslagen")
        return

    with open(md_path) as f:
        md = f.read()

    body = md_to_html(md)

    risk_color = "#6b7280"
    if "🔴" in md:
        risk_color = "#dc2626"
    elif "🟡" in md:
        risk_color = "#d97706"
    elif "🟢" in md:
        risk_color = "#16a34a"

    html = f"""<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Juridisch advies — {app_name}</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 760px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
      color: #1a1a2e;
      background: #f8f9fa;
      line-height: 1.7;
    }}
    .header {{
      background: #1a1a2e;
      color: white;
      padding: 1.5rem 2rem;
      border-radius: 10px;
      margin-bottom: 2rem;
    }}
    .header h1 {{ margin: 0 0 .25rem; font-size: 1.4rem; }}
    .header .meta {{ font-size: .85rem; opacity: .7; }}
    .risk-badge {{
      display: inline-block;
      background: {risk_color};
      color: white;
      padding: .2rem .7rem;
      border-radius: 20px;
      font-size: .8rem;
      font-weight: 600;
      margin-top: .5rem;
    }}
    .content {{
      background: white;
      padding: 2rem;
      border-radius: 10px;
      box-shadow: 0 1px 3px rgba(0,0,0,.08);
    }}
    h1 {{ display: none; }}
    h2 {{ color: #1a1a2e; border-bottom: 2px solid #e5e7eb; padding-bottom: .4rem; margin-top: 2rem; font-size: 1.15rem; }}
    h3 {{ color: #374151; font-size: 1rem; margin-top: 1.5rem; }}
    h4 {{ color: #6b7280; font-size: .95rem; }}
    hr {{ border: none; border-top: 1px solid #e5e7eb; margin: 1.5rem 0; }}
    blockquote {{
      background: #fef9c3;
      border-left: 4px solid #eab308;
      padding: .75rem 1rem;
      margin: 1rem 0;
      border-radius: 0 6px 6px 0;
    }}
    blockquote p {{ margin: 0; color: #713f12; font-size: .9rem; }}
    ul {{ padding-left: 1.2rem; }}
    ul.checklist {{ list-style: none; padding-left: 0; }}
    ul.checklist li {{ padding: .3rem 0; display: flex; gap: .5rem; align-items: baseline; }}
    ul.checklist li .cb {{ font-size: 1rem; flex-shrink: 0; }}
    ul.checklist li.done {{ color: #6b7280; text-decoration: line-through; }}
    code {{ background: #f1f5f9; padding: .1rem .4rem; border-radius: 4px; font-size: .85rem; }}
    strong {{ color: #111827; }}
    a {{ color: #2563eb; }}
    p {{ margin: .5rem 0; }}
    .back {{ display: inline-block; margin-bottom: 1.5rem; color: #6b7280; font-size: .9rem; text-decoration: none; }}
    .back:hover {{ color: #1a1a2e; }}
  </style>
</head>
<body>
  <a class="back" href="../">← Terug naar app</a>
  <div class="header">
    <h1>⚖️ Juridisch advies</h1>
    <div class="meta">Opgesteld door Jurry · Goosie Labs</div>
  </div>
  <div class="content">
{body}
  </div>
</body>
</html>"""

    # Bepaal de serveer-mappen op basis van wat er aanwezig is
    serve_dirs = []
    for subdir in ["dist", "public", "frontend"]:
        target_dir = os.path.join(app_dir, subdir)
        if os.path.isdir(target_dir):
            serve_dirs.append(target_dir)

    # Geen van de standaard mappen? Schrijf naar de app-root
    if not serve_dirs:
        serve_dirs = [app_dir]

    for target_dir in serve_dirs:
        out_path = os.path.join(target_dir, "juridischadvies.html")
        with open(out_path, "w") as f:
            f.write(html)
        rel = os.path.relpath(target_dir, APPS_DIR)
        print(f"  ✓ {rel}/juridischadvies.html")


if __name__ == "__main__":
    apps_arg = sys.argv[1:] if len(sys.argv) > 1 else None

    if apps_arg:
        apps = apps_arg
    else:
        apps = [
            d for d in os.listdir(APPS_DIR)
            if os.path.isdir(os.path.join(APPS_DIR, d))
            and not os.path.exists(os.path.join(APPS_DIR, d, ".archived"))
        ]

    print(f"\n⚖️  Jurry — HTML genereren voor {len(apps)} app(s)\n")
    for app in sorted(apps):
        generate(app)
    print("\n✅ Klaar.\n")
