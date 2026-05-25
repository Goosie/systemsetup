# Goosie Labs Server Structure

## Rules — where does a file belong?

### agents/<name>/
- Instructions FOR an AI agent
- CLAUDE.md, tasks.md, README.md
- Defines the "brain" of an agent

### apps/<name>/          (/var/www/goosielabs/apps/)
- Running web application with a URL
- Built with newapp
- Has nginx config + pm2/systemd service
- NEVER move existing apps — links will break

### projects/<name>/
- Your own work for a project
- No URL, not a running service
- Scripts, contracts, docs, design files
- Subdirs: tools/, deps/, contracts/, docs/

### projects/<name>/deps/
- Cloned or downloaded external code
- Not written by you
- Required as dependency

## Current Structure
/home/deploy/
├── agents/
│   ├── rgb/          ← @rgb agent brain
│   ├── astrid/
│   └── jurry/
├── projects/
│   ├── rgb/
│   │   ├── tools/    ← rgbinstall.sh etc.
│   │   ├── deps/     ← rgb-schemata
│   │   └── contracts/← GOOSE.contract.rgb etc.
│   └── goosiepress/
└── claude-config/

/var/www/goosielabs/apps/   ← NEVER TOUCH existing apps
