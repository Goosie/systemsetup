# Git Workflow — Goosie Labs

Regels voor Astrid, Claude en alle andere ganzen. Ideeën gaan snel bij Goosie Labs —
de git-discipline houdt alles terugvindbaar en omkeerbaar.

---

## Branches

| Patroon | Gebruik | Voorbeeld |
|---------|---------|-----------|
| `main` | Altijd stabiel. Nooit direct op committen. | — |
| `astrid/<feature>` | Astrid's feature branches | `astrid/donatie-knop-2026-05` |
| `claude/<feature>` | Claude Code branches vanuit de web-agent | `claude/dual-site-architecture` |
| `experiment/<naam>` | Wilde ideeën, mogen breken | `experiment/rgb-airdrop` |
| `fix/<wat>` | Bugfixes | `fix/lnurl-timeout` |
| `hotfix/<wat>` | Urgente productiefix | `hotfix/relay-disconnect` |

**Regel:** nooit direct pushen naar `main`. Altijd via branch + merge.

---

## Commit formaat — Conventional Commits

```
<type>(<scope>): <beschrijving in het Nederlands>
```

| Type | Wanneer |
|------|---------|
| `feat` | Nieuwe functionaliteit |
| `fix` | Bug opgelost |
| `chore` | Deps, configs, tooling — geen logicawijziging |
| `docs` | Alleen documentatie |
| `refactor` | Code anders geschreven, zelfde gedrag |
| `experiment` | Iets uitproberen, mag instabiel zijn |
| `revert` | Iets terugdraaien |

**Voorbeelden:**
```
feat(donatie): publishVote() toegevoegd — stem op Nostr na betaling
fix(lnurl): timeout verhoogd naar 10s voor trage wallets
chore: DonationButton template bijgewerkt
docs: git-workflow gedocumenteerd
experiment(rgb): eerste Taproot Assets airdrop geprobeerd
revert: rgb-airdrop teruggedraaid — tooling nog niet rijp
```

**Scope** is optioneel maar helpt: naam van de app, feature of agent.

---

## Tags — wanneer en hoe

Tags markeren momenten die de moeite waard zijn om terug te vinden.

| Formaat | Gebruik | Voorbeeld |
|---------|---------|-----------|
| `v{major}.{minor}.{patch}` | Repo-brede releases | `v1.0.0` |
| `{app}-v{major}.{minor}` | App-specifieke releases | `ididhere-v2.1` |
| `experiment/{naam}-v{n}` | Experimentele mijlpalen | `experiment/rgb-v0.1` |
| `pivot/{datum}` | Richtingswijziging vastleggen | `pivot/2026-05-naar-nsite` |

**Annotated tag aanmaken:**
```bash
git tag -a ididhere-v2.1 -m "IDidHere: NIP-58 badges werkend + DonationButton"
git push origin ididhere-v2.1
```

**Pivot tag** — gebruik dit als je iets terugdraait of drastisch van richting verandert:
```bash
git tag -a pivot/2026-05-nsite -m "Besluit: nsite naast WordPress i.p.v. vervanging"
git push origin pivot/2026-05-nsite
```

---

## Ruby Review — vóór merge naar main

Ruby is de Chief Reality Officer. Ze vraagt de kritische vragen *voordat* iets live gaat.

**Verplicht vóór elke merge naar main:**

```bash
# Voer dit uit op de branch die je wilt mergen
node /home/deploy/scripts/ruby/review.mjs
```

Ruby checkt automatisch:
- [ ] Geen hardcoded secrets, API keys of nsec-sleutels in de code
- [ ] Feature flags aanwezig voor nieuwe UI-elementen
- [ ] Geen `TODO` of `FIXME` in productie-code zonder issue
- [ ] juridischadvies.md is niet leeg bij nieuwe apps
- [ ] Alle nieuwe dependencies zijn gecontroleerd door Jurry (`jurry licenses`)

Als Ruby waarschuwingen heeft, worden ze opgeslagen in `RUBY-REVIEW.md` op de branch.
Perry beslist of waarschuwingen blockers zijn. Als je ze negeert, zet je een korte reden:

```markdown
<!-- RUBY: [waarschuwing] — genegeerd omdat: [reden] -->
```

---

## Feature flags — Kill Switch

Elke nieuwe UI-feature krijgt een feature flag. Dit betekent dat Perry
een feature in één commando kan uitzetten *zonder* code te schrijven:

```bash
# In de app-directory:
node scripts/toggle-feature.mjs donationButton false   # uitzetten
node scripts/toggle-feature.mjs donationButton true    # aanzetten
node scripts/toggle-feature.mjs --list                 # overzicht
```

App rebuildt automatisch. Feature is onmiddellijk weg.

**Sjablonen in systemsetup:**
- `templates/features.ts` — de flags zelf
- `templates/useFeatureFlag.ts` — React hook
- `templates/toggle-feature.mjs` — CLI kill switch
- `templates/DonationButton.tsx` — voorbeeld van feature-flagged component

Elke nieuwe app krijgt deze bestanden automatisch via `newapp <naam>`.

---

## Merge procedure (Astrid's checklist)

```
1. git checkout -b astrid/<feature>
2. ... bouwen en committen ...
3. git diff main...HEAD                    ← reviewen wat je gaat mergen
4. node /home/deploy/scripts/ruby/review.mjs   ← Ruby's review
5. Waarschuwingen behandelen of gedocumenteerd negeren
6. git checkout main && git merge astrid/<feature>
7. git tag -a <tag> -m "<beschrijving>"  ← als het een release is
8. git push && git push --tags
9. git branch -d astrid/<feature>         ← branch opruimen
```

---

## Iets terugdraaien

Als Perry een feature niet bevalt:

**Optie A — Feature flag (snel, geen codewijziging):**
```bash
node scripts/toggle-feature.mjs <feature> false
```

**Optie B — Commit revert (als er geen flag is):**
```bash
git revert <commit-hash>
git commit -m "revert(<scope>): <feature> teruggedraaid — niet wat we wilden"
```

**Optie C — Branch weggooien (als het nog niet gemerged is):**
```bash
git checkout main
git branch -D astrid/<feature>
```

Kies altijd de minst destructieve optie.
