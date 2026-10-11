#!/usr/bin/env python3
"""Deep-merge new UI strings into messages/en.json and messages/fr.json.

    python3 scripts/dev/add-messages.py new.json

new.json: {"en": {"namespace": {"key": "Text"}}, "fr": {"namespace": {"key": "Texte"}}}
Run from the repository root. Keeps 2-space JSON and UTF-8 characters.
Both languages are required, with the same placeholders (tests/locale.test.ts).
"""
import json
import sys

src = json.load(open(sys.argv[1], encoding="utf-8"))


def merge(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict):
            merge(a[k], v)
        else:
            a[k] = v


for lang in ("en", "fr"):
    if lang not in src:
        sys.exit(f"missing '{lang}' block")
    path = f"messages/{lang}.json"
    data = json.load(open(path, encoding="utf-8"))
    merge(data, src[lang])
    open(path, "w", encoding="utf-8").write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
print("ok")
