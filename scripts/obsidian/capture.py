#!/usr/bin/env python3
"""
Claude Code Stop hook — slaat elk gesprek op als Obsidian nota.

Wordt automatisch aangeroepen als Claude Code stopt.
Ontvangt JSON van Claude Code via stdin:
  { "session_id": "...", "transcript_path": "...", "cwd": "..." }

Maakt een nota aan in /home/deploy/ObsidianClaudeFault/gesprekken/
"""

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

VAULT = Path("/home/deploy/ObsidianClaudeFault")


def slugify(text: str) -> str:
    text = text.lower().strip()[:60]
    text = re.sub(r"[^\w\s-]", "", text)
    return re.sub(r"[\s_-]+", "-", text).strip("-")


def extract_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            block.get("text", "") for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )
    return ""


def parse_transcript(path: str) -> list[tuple[str, str]]:
    """Leest een Claude Code JSONL transcript en geeft (role, text) tuples terug."""
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

                entry_type = entry.get("type")
                if entry_type == "summary":
                    # Compacted conversation summary
                    summary = entry.get("summary", "")
                    if summary:
                        messages.append(("summary", summary))
                    continue

                msg = entry.get("message", {})
                role = msg.get("role") or entry.get("role", "")
                content = msg.get("content") or entry.get("content", "")
                text = extract_text(content).strip()

                if role in ("user", "human") and text:
                    # Filter systeem-reminders en tool-resultaten eruit
                    if not text.startswith("<system-reminder") and len(text) > 10:
                        messages.append(("user", text))
                elif role == "assistant" and text:
                    messages.append(("assistant", text))

    except Exception as e:
        print(f"[obsidian] Fout bij lezen transcript: {e}", file=sys.stderr)

    return messages


def infer_title(messages: list[tuple[str, str]]) -> str:
    for role, text in messages:
        if role == "user":
            # Eerste echte zin van de gebruiker als titel
            first_line = text.split("\n")[0].strip()
            return first_line[:80]
    return "gesprek"


def build_note(messages: list[tuple[str, str]], session_id: str, cwd: str, date: str) -> str:
    project = os.path.basename(cwd) if cwd else "unknown"
    title = infer_title(messages)

    lines = [
        "---",
        f"date: {date}",
        f"session: {session_id}",
        f"project: {project}",
        f"tags: [gesprek, project/{project}]",
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

    lines += [
        "## Gerelateerd",
        "",
        "- [[00-Index]]",
        f"- [[apps/{project}]] _(indien van toepassing)_",
        "",
    ]

    return "\n".join(lines)


def main():
    raw = sys.stdin.read().strip()
    if not raw:
        sys.exit(0)

    try:
        hook_data = json.loads(raw)
    except json.JSONDecodeError:
        sys.exit(0)

    session_id = hook_data.get("session_id", "unknown")
    transcript_path = hook_data.get("transcript_path", "")
    cwd = hook_data.get("cwd", "")

    if not transcript_path or not os.path.exists(transcript_path):
        print("[obsidian] Geen transcript gevonden, niks opgeslagen.", file=sys.stderr)
        sys.exit(0)

    messages = parse_transcript(transcript_path)
    if not messages:
        sys.exit(0)

    date = datetime.now().strftime("%Y-%m-%d")
    title = infer_title(messages)
    slug = slugify(title)
    filename = f"{date}-{slug}.md"

    output_dir = VAULT / "gesprekken"
    output_dir.mkdir(parents=True, exist_ok=True)

    output_file = output_dir / filename
    if output_file.exists():
        short_id = session_id[:8] if len(session_id) >= 8 else session_id
        filename = f"{date}-{slug}-{short_id}.md"
        output_file = output_dir / filename

    note = build_note(messages, session_id, cwd, date)
    output_file.write_text(note, encoding="utf-8")
    print(f"[obsidian] Gesprek opgeslagen: {output_file}")


if __name__ == "__main__":
    main()
