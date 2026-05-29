#!/usr/bin/env python3
"""
Importeer bestaande Claude Code sessie-transcripten naar de Obsidian vault.

Scant ~/.claude/projects/ voor alle .jsonl bestanden en maakt per sessie
een nota aan in /home/deploy/ObsidianClaudeFault/gesprekken/.

Gebruik:
  python3 import-history.py              # importeer alles
  python3 import-history.py --dry-run    # toon wat geïmporteerd zou worden
  python3 import-history.py --list       # lijst van alle gevonden sessies
"""

import argparse
import base64
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

VAULT = Path("/home/deploy/ObsidianClaudeFault")
CLAUDE_DIR = Path.home() / ".claude" / "projects"


def slugify(text: str) -> str:
    text = text.lower().strip()[:60]
    text = re.sub(r"[^\w\s-]", "", text)
    return re.sub(r"[\s_-]+", "-", text).strip("-")


def extract_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            b.get("text", "") for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""


def decode_project_path(encoded: str) -> str:
    """Claude Code encodeert het project-pad als base64url in de map-naam."""
    try:
        # Voeg padding toe als nodig
        padded = encoded + "=" * (-len(encoded) % 4)
        return base64.urlsafe_b64decode(padded).decode("utf-8")
    except Exception:
        return encoded


def parse_transcript(path: Path) -> list[tuple[str, str]]:
    messages = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if entry.get("type") == "summary":
                    summary = entry.get("summary", "")
                    if summary:
                        messages.append(("summary", summary))
                    continue

                msg = entry.get("message", {})
                role = msg.get("role") or entry.get("role", "")
                content = msg.get("content") or entry.get("content", "")
                text = extract_text(content).strip()

                if role in ("user", "human") and text:
                    if not text.startswith("<system-reminder") and len(text) > 10:
                        messages.append(("user", text))
                elif role == "assistant" and text:
                    messages.append(("assistant", text))
    except Exception as e:
        print(f"  ⚠️  Fout bij lezen {path}: {e}", file=sys.stderr)

    return messages


def infer_title(messages: list[tuple[str, str]]) -> str:
    for role, text in messages:
        if role == "user":
            return text.split("\n")[0].strip()[:80]
    return "gesprek"


def get_file_date(path: Path) -> str:
    mtime = path.stat().st_mtime
    return datetime.fromtimestamp(mtime).strftime("%Y-%m-%d")


def build_note(messages, session_id, project, date) -> str:
    title = infer_title(messages)
    lines = [
        "---",
        f"date: {date}",
        f"session: {session_id}",
        f"project: {project}",
        f"tags: [gesprek, project/{slugify(project)}, geimporteerd]",
        "---",
        "",
        f"# {title}",
        "",
    ]
    for role, text in messages:
        if role == "summary":
            lines += ["## Samenvatting (gecomprimeerde context)", "", text, "", "---", ""]
        elif role == "user":
            lines += ["## Prompt", "", text, "", "---", ""]
        elif role == "assistant":
            lines += ["## Reactie", "", text, "", "---", ""]
    lines += ["## Gerelateerd", "", "- [[00-Index]]", ""]
    return "\n".join(lines)


def find_all_transcripts() -> list[tuple[Path, str, str]]:
    """Geeft lijst van (jsonl_path, project_name, session_id)."""
    results = []
    if not CLAUDE_DIR.exists():
        return results

    for project_dir in CLAUDE_DIR.iterdir():
        if not project_dir.is_dir():
            continue
        project_name = os.path.basename(decode_project_path(project_dir.name))
        for jsonl in project_dir.glob("*.jsonl"):
            session_id = jsonl.stem
            results.append((jsonl, project_name, session_id))

    results.sort(key=lambda x: x[0].stat().st_mtime)
    return results


def main():
    parser = argparse.ArgumentParser(description="Importeer Claude Code history naar Obsidian vault")
    parser.add_argument("--dry-run", action="store_true", help="Toon wat geïmporteerd zou worden zonder te schrijven")
    parser.add_argument("--list", action="store_true", help="Toon gevonden sessies")
    args = parser.parse_args()

    transcripts = find_all_transcripts()

    if not transcripts:
        print(f"Geen sessie-transcripten gevonden in {CLAUDE_DIR}")
        print("Claude Code slaat sessies op in ~/.claude/projects/")
        sys.exit(0)

    if args.list:
        print(f"\n{'Datum':<12} {'Project':<25} {'Sessie-ID'}")
        print("-" * 70)
        for path, project, session_id in transcripts:
            date = get_file_date(path)
            print(f"{date:<12} {project:<25} {session_id[:40]}")
        print(f"\nTotaal: {len(transcripts)} sessies")
        return

    output_dir = VAULT / "gesprekken"
    if not args.dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)

    imported = 0
    skipped = 0

    for path, project, session_id in transcripts:
        messages = parse_transcript(path)
        if not messages:
            skipped += 1
            continue

        date = get_file_date(path)
        title = infer_title(messages)
        slug = slugify(title)
        short_id = session_id[:8] if len(session_id) >= 8 else session_id
        filename = f"{date}-{slug}-{short_id}.md"
        output_file = output_dir / filename

        if args.dry_run:
            msg_count = len(messages)
            print(f"[dry-run] {filename} ({msg_count} berichten, project: {project})")
            imported += 1
            continue

        if output_file.exists():
            skipped += 1
            continue

        note = build_note(messages, session_id, project, date)
        output_file.write_text(note, encoding="utf-8")
        print(f"✅ {filename}")
        imported += 1

    verb = "te importeren" if args.dry_run else "geïmporteerd"
    print(f"\n{imported} sessies {verb}, {skipped} overgeslagen (leeg of al aanwezig)")
    if not args.dry_run:
        print(f"Vault: {VAULT}/gesprekken/")


if __name__ == "__main__":
    main()
