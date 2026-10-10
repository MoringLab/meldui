#!/usr/bin/env python3
"""Local-workstation helper: run a command with OMNIROUTE_API_KEY taken from the local OmniRoute store.

The key is passed through the child's environment only. It is never printed, written to disk or committed.
Usage: scripts/local/with-omniroute-key.py pnpm exec tsx apps/server/src/index.ts
"""
import os
import sqlite3
import sys

row = sqlite3.connect("file:" + os.path.expanduser("~/.omniroute/storage.sqlite") + "?mode=ro", uri=True).execute(
    "SELECT key FROM api_keys WHERE is_active=1 AND key IS NOT NULL LIMIT 1"
).fetchone()
if not row:
    sys.exit("No active OmniRoute API key found; set OMNIROUTE_API_KEY manually.")
env = dict(os.environ, OMNIROUTE_API_KEY=row[0])
os.execvpe(sys.argv[1], sys.argv[1:], env)
