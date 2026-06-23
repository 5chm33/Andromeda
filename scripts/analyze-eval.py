import json

with open('data/eval_baseline.json') as f:
    d = json.load(f)

failing = [r for r in d['results'] if r['score'] < 65]
print(f"Total failing/partial: {len(failing)}\n")
for r in failing:
    print(f"Task: {r['taskId']} | Score: {r['score']}")
    print(f"  Response: {r['response'][:150]}")
    print()
