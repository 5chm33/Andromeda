#!/usr/bin/env python3
"""Inject a safe JSDoc documentation proposal into the proposals store."""
import json
import time
import random
import string

proposals_path = '/home/ubuntu/andromeda_git/workspace/.andromeda_proposals.json'

with open(proposals_path) as f:
    store = json.load(f)

rand = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
proposal_id = f"prop_{int(time.time()*1000)}_{rand}"

# A completely safe proposal: add JSDoc to getLogLevel() in cache.ts
# This only adds a comment - cannot break any tests
safe_proposal = {
    "id": proposal_id,
    "targetFile": "server/cache.ts",
    "title": "Add JSDoc documentation to getLogLevel function",
    "rationale": "Improves code documentation and developer experience without changing behavior",
    "category": "readability",
    "impact": "low",
    "confidence": 0.99,
    "status": "pending",
    "createdAt": time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime()),
    "originalSnippet": "export function getLogLevel(): LogLevel {\n  return currentLogLevel;\n}",
    "proposedSnippet": "/** Returns the current minimum log level. Logs below this level are suppressed. */\nexport function getLogLevel(): LogLevel {\n  return currentLogLevel;\n}"
}

store['proposals'].append(safe_proposal)

with open(proposals_path, 'w') as f:
    json.dump(store, f, indent=2)

print(f"Injected proposal: {proposal_id}")
print(f"Total proposals: {len(store['proposals'])}")
