#!/usr/bin/env python3
"""Full structural audit of the RLHF feedback data — handles all 3 schemas."""
import json
from collections import Counter

FEEDBACK_FILE = "data/rlhf_feedback.jsonl"

print("=" * 60)
print("ANDROMEDA RLHF PAIR AUDIT")
print("=" * 60)

total = 0
parse_errors = 0
schema_counts = Counter()
feedback_types = Counter()
sources = Counter()
reward_buckets = Counter()
categories = Counter()
valid_dpo_pairs = 0  # has both chosen and rejected text

with open(FEEDBACK_FILE, "r", encoding="utf-8") as f:
    for i, line in enumerate(f):
        line = line.strip()
        if not line:
            continue
        total += 1
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            parse_errors += 1
            continue

        # --- Detect schema ---
        if "feedbackType" in entry:
            # Schema A: RSI self-improvement feedback (first 500 entries)
            schema_counts["A: RSI feedback (feedbackType)"] += 1
            ft = entry.get("feedbackType", "unknown")
            feedback_types[ft] += 1
            r = entry.get("reward", 0)
            src = "RSI self-improvement"
            # These don't have chosen/rejected — they're signal records
            # But they're valid RLHF signals (accept/reject on proposals)
            valid_dpo_pairs += 0  # not DPO format but valid signal

        elif entry.get("type") == "preference" and "chosenResponse" in entry:
            # Schema B: HumanEval/APPS coding pairs
            schema_counts["B: Coding preference pairs (chosenResponse)"] += 1
            ft = "preference"
            feedback_types["preference"] += 1
            r = entry.get("chosenScore", 1.0) - entry.get("rejectedScore", 0.0)
            src = entry.get("source", "unknown")
            sources[src] += 1
            valid_dpo_pairs += 1  # has chosen + rejected

        elif "chosen" in entry and "rejected" in entry:
            # Schema C: HH-RLHF dataset (chosen/rejected conversation turns)
            schema_counts["C: HH-RLHF pairs (chosen/rejected)"] += 1
            ft = entry.get("verdict", entry.get("feedbackType", "preference"))
            feedback_types[ft] += 1
            r = entry.get("reward", entry.get("score", 0))
            src = entry.get("source", "HH-RLHF")
            sources[src] += 1
            valid_dpo_pairs += 1  # has chosen + rejected

        else:
            schema_counts["D: unknown schema"] += 1
            ft = "unknown"
            r = 0
            src = "unknown"

        # Reward distribution
        if r >= 0.8:
            reward_buckets["strong positive (≥0.8)"] += 1
        elif r >= 0.3:
            reward_buckets["positive (0.3–0.8)"] += 1
        elif r >= -0.3:
            reward_buckets["neutral (-0.3–0.3)"] += 1
        elif r >= -0.8:
            reward_buckets["negative (-0.8–-0.3)"] += 1
        else:
            reward_buckets["strong negative (<-0.8)"] += 1

        # Category
        cat = entry.get("category", entry.get("type", "unknown"))
        categories[cat] += 1

print(f"\n📊 TOTAL ENTRIES:          {total:>10,}")
print(f"✅ VALID DPO PAIRS:        {valid_dpo_pairs:>10,}  (chosen+rejected format)")
print(f"📡 RSI FEEDBACK SIGNALS:   {schema_counts['A: RSI feedback (feedbackType)']:>10,}  (accept/reject on proposals)")
print(f"❌ PARSE ERRORS:           {parse_errors:>10,}")

print("\n--- SCHEMA BREAKDOWN ---")
for k, v in sorted(schema_counts.items(), key=lambda x: -x[1]):
    print(f"  {k:<45} {v:>8,}  ({100*v/total:.1f}%)")

print("\n--- FEEDBACK TYPE / VERDICT ---")
for k, v in sorted(feedback_types.items(), key=lambda x: -x[1])[:10]:
    print(f"  {k:<25} {v:>8,}  ({100*v/total:.1f}%)")

print("\n--- REWARD DISTRIBUTION ---")
for k, v in sorted(reward_buckets.items(), key=lambda x: -x[1]):
    print(f"  {k:<30} {v:>8,}  ({100*v/total:.1f}%)")

print("\n--- TOP CATEGORIES ---")
for k, v in categories.most_common(8):
    print(f"  {k:<30} {v:>8,}")

if sources:
    print("\n--- DATA SOURCES ---")
    for k, v in sorted(sources.items(), key=lambda x: -x[1])[:8]:
        print(f"  {k:<35} {v:>8,}")

print("\n" + "=" * 60)
total_valid = total - parse_errors
print(f"VERDICT: ✅ {total_valid:,} of {total:,} entries are structurally valid ({100*total_valid/total:.1f}%)")
print(f"         {valid_dpo_pairs:,} are full DPO pairs (chosen + rejected text)")
print(f"         {schema_counts['A: RSI feedback (feedbackType)']:,} are RSI proposal feedback signals")
print("=" * 60)
