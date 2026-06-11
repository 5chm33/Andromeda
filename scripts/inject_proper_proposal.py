#!/usr/bin/env python3
"""Inject a proper proposal with full proposedContent into the proposals store."""
import json
import time
import random
import string

proposals_path = '/home/ubuntu/andromeda_git/workspace/.andromeda_proposals.json'
cache_ts_path = '/home/ubuntu/andromeda_git/server/cache.ts'

# Read the current cache.ts content
with open(cache_ts_path) as f:
    original_content = f.read()

# Apply the JSDoc change to create proposedContent
old_snippet = 'export function getLogLevel(): LogLevel {\n  return currentLogLevel;\n}'
new_snippet = '/** Returns the current minimum log level. Logs below this level are suppressed. */\nexport function getLogLevel(): LogLevel {\n  return currentLogLevel;\n}'

if old_snippet in original_content:
    proposed_content = original_content.replace(old_snippet, new_snippet, 1)
    print("Created proposedContent with JSDoc added")
elif new_snippet in original_content:
    # Already applied - use a different change
    old_snippet2 = 'export function setLogLevel(level: LogLevel): void {'
    new_snippet2 = '/** Sets the minimum log level. Messages below this level will be filtered out. */\nexport function setLogLevel(level: LogLevel): void {'
    if old_snippet2 in original_content:
        proposed_content = original_content.replace(old_snippet2, new_snippet2, 1)
        old_snippet = old_snippet2
        new_snippet = new_snippet2
        print("Created proposedContent with setLogLevel JSDoc added")
    else:
        print("ERROR: Could not find target function in cache.ts")
        import sys; sys.exit(1)
else:
    print("ERROR: Could not find getLogLevel in cache.ts")
    import sys; sys.exit(1)

# Load existing proposals
with open(proposals_path) as f:
    store = json.load(f)

rand = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
proposal_id = f"prop_{int(time.time()*1000)}_{rand}"

proper_proposal = {
    "id": proposal_id,
    "targetFile": "server/cache.ts",
    "title": "Add JSDoc documentation to log level functions",
    "rationale": "Improves code documentation and developer experience without changing runtime behavior. JSDoc comments help IDEs provide better autocomplete and type hints.",
    "category": "readability",
    "impact": "low",
    "confidence": 0.99,
    "status": "pending",
    "createdAt": int(time.time() * 1000),
    "originalSnippet": old_snippet,
    "proposedSnippet": new_snippet,
    "proposedContent": proposed_content,
}

store['proposals'].append(proper_proposal)

with open(proposals_path, 'w') as f:
    json.dump(store, f, indent=2)

print(f"Injected proposal: {proposal_id}")
print(f"Total proposals: {len(store['proposals'])}")
print(f"proposedContent length: {len(proposed_content)} chars")

# Output the proposal ID for use in the apply command
print(f"\nPROPOSAL_ID={proposal_id}")
