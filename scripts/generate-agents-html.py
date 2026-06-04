#!/usr/bin/env python3
"""
generate-agents-html.py
Generates the V-Formation agents section for the WordPress landing page.
Reads agent data from /home/deploy/agents/<name>/nostr-key.json
and prompts from /home/deploy/.claude/agents/<name>.md
"""

import json, os, re

KEYS_DIR   = '/home/deploy/agents'
CLAUDE_DIR = '/home/deploy/.claude/agents'

AGENT_COLORS = {
    'assistenty':    '#6366f1',
    'danky':     '#0ea5e9',
    'finny':     '#10b981',
    'haitje':    '#f59e0b',
    'jurry':     '#8b5cf6',
    'secury':    '#ef4444',
    'tessa':     '#ec4899',
    'checky':    '#14b8a6',
    'commy':     '#f97316',
    'designy':   '#a855f7',
    'nosty':     '#06b6d4',
    'admission': '#64748b',
    'ruby':      '#e11d48',
}

ORDER = ['assistenty', 'danky', 'finny', 'haitje', 'jurry', 'secury', 'tessa',
         'checky', 'commy', 'designy', 'nosty', 'admission', 'ruby']

agents = []
for name in os.listdir(KEYS_DIR):
    key_file = os.path.join(KEYS_DIR, name, 'nostr-key.json')
    if not os.path.exists(key_file):
        continue
    try:
        key = json.loads(open(key_file).read())
        npub = key.get('npub', '')
        if not npub:
            continue
    except:
        continue

    description = ''
    md_file = os.path.join(CLAUDE_DIR, f'{name}.md')
    if os.path.exists(md_file):
        md = open(md_file).read()
        m = re.search(r'^description:\s*(.+)$', md, re.MULTILINE)
        if m:
            description = m.group(1).strip().strip('"\'')

    agents.append({'name': name, 'npub': npub, 'description': description})

agents.sort(key=lambda a: ORDER.index(a['name']) if a['name'] in ORDER else 99)

cards = []
for a in agents:
    name = a['name']
    title = name.capitalize()
    npub = a['npub']
    nsite_url = f'https://nsite.goosielabs.com/{npub}/'
    color = AGENT_COLORS.get(name, '#6366f1')
    initial = title[0]
    desc = a['description'][:120] + ('…' if len(a['description']) > 120 else '')

    cards.append(f'''      <a href="{nsite_url}" class="agent-card" target="_blank" rel="noopener">
        <div class="agent-avatar" style="background:{color}">{initial}</div>
        <div class="agent-info">
          <div class="agent-name">{title}</div>
          <div class="agent-desc">{desc}</div>
        </div>
      </a>''')

print('\n'.join(cards))
