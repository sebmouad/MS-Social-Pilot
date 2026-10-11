---
name: ux-copy-house
description: Write UI text for MS Social Pilot in its house style, in English and French — buttons, errors, empty states, confirmations, hints, tooltips.
---

# House style for UI copy

- Plain, specific, calm. Say what happens, then what to do. No jargon, no Graph
  metric names, no "Are you sure?".
- Buttons: verb + object ("Delete from Facebook", "Schedule email", "Keep post").
- Errors: what happened + why + how to fix. Pass the platform's own refusal through
  when it is the real reason ("Facebook refused: …").
- Empty states: what this is + why it is empty + the one action that fills it.
  If nothing the user can do fills it, say what they are waiting for.
- Confirmations: title = the question ("Delete this post from Facebook?"), body
  = the consequence ("It disappears from the Page… cannot be undone").
- Both catalogues (`messages/en.json`, `messages/fr.json`), same keys and
  placeholders; counts as ICU plurals (`{count, plural, one {…} other {# …}}`).
  French: tutoiement only where the brand voice says so; typographic apostrophes
  ’ and non-breaking space before `: ; ? !`.
- Add with `python3 scripts/dev/add-messages.py file.json`; `tests/locale.test.ts`
  must pass.
