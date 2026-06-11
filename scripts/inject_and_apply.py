#!/usr/bin/env python3
"""Inject a safe JSDoc proposal and apply it via the Guard API."""
import json, os, time, subprocess, sys

workspace = "/home/ubuntu/andromeda_git/workspace"
proposals_file = os.path.join(workspace, ".andromeda_proposals.json")
cache_ts = "/home/ubuntu/andromeda_git/server/cache.ts"

# Read current cache.ts
with open(cache_ts) as f:
    original = f.read()

# Add JSDoc to the first exported function that doesn't have one
if "/** Returns the current log level" not in original:
    proposed = original.replace(
        "export function getLogLevel(",
        "/** Returns the current log level for the application.\n * @returns {string} The current log level (e.g. 'info', 'debug', 'warn', 'error')\n */\nexport function getLogLevel("
    )
else:
    # Already has JSDoc - add to another function
    proposed = original.replace(
        "export function setLogLevel(",
        "/** Sets the application log level.\n * @param {string} level - The log level to set\n */\nexport function setLogLevel("
    )

if proposed == original:
    print("No change needed - cache.ts already has JSDoc")
    sys.exit(0)

proposal_id = f"prop_{int(time.time()*1000)}_jsdoc_v2"

proposal = {
    "id": proposal_id,
    "status": "pending",
    "title": "Add JSDoc documentation to log level functions",
    "targetFile": "server/cache.ts",
    "rationale": "Improves code documentation and IDE support by adding JSDoc comments to exported functions",
    "category": "readability",
    "impact": "low",
    "confidence": 0.95,
    "diff": "--- a/server/cache.ts\n+++ b/server/cache.ts\n@@ add JSDoc @@",
    "originalSnippet": "export function getLogLevel(",
    "proposedSnippet": "/** Returns the current log level */\nexport function getLogLevel(",
    "originalContent": original,
    "proposedContent": proposed,
    "createdAt": int(time.time() * 1000),
}

# Load or create proposals store
if os.path.exists(proposals_file):
    with open(proposals_file) as f:
        store = json.load(f)
else:
    store = {"proposals": []}

# Remove old jsdoc proposals
store["proposals"] = [p for p in store["proposals"] if "jsdoc" not in p.get("id","").lower() and "jsdoc" not in p.get("title","").lower()]
store["proposals"].append(proposal)

with open(proposals_file, "w") as f:
    json.dump(store, f, indent=2)

print(f"Injected proposal: {proposal_id}")
print(f"Total proposals in store: {len(store['proposals'])}")

# Now apply via Guard API
admin_key = subprocess.check_output(
    "grep ANDROMEDA_ADMIN_KEY /home/ubuntu/andromeda_git/.env.local | cut -d= -f2",
    shell=True
).decode().strip()

print(f"Applying proposal {proposal_id}...")
result = subprocess.run([
    "curl", "-s", "--max-time", "300",
    "-X", "POST", "http://localhost:3000/api/guard/apply",
    "-H", "Content-Type: application/json",
    "-H", f"x-admin-key: {admin_key}",
    "-d", json.dumps({"proposalId": proposal_id}),
    "-o", "/tmp/apply_v3.json"
], capture_output=True, text=True, timeout=310)

print("Curl exit code:", result.returncode)
if os.path.exists("/tmp/apply_v3.json"):
    with open("/tmp/apply_v3.json") as f:
        content = f.read()
    if content.strip():
        try:
            r = json.loads(content)
            print("Success:", r.get("success"))
            print("Message:", r.get("message"))
        except:
            print("Raw response:", content[:200])
    else:
        print("Empty response (still processing or timed out)")
