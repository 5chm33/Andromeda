#!/usr/bin/env python3
"""Analyze failing eval tasks to understand why they fail."""
import json

with open('data/eval_baseline.json') as f:
    data = json.load(f)

failing = ['r03','r05','r06','r08','r10','t04','t07','t09','s03','s09','s10','m01','m02','m07','m08','si04','si05']

for task in data.get('taskResults', []):
    if task['id'] in failing:
        print(f"=== {task['id']} ({task['score']}/100) ===")
        print(f"Prompt: {task.get('prompt','')[:200]}")
        print(f"Expected: {task.get('expectedKeywords','')}")
        print(f"Response: {task.get('response','')[:300]}")
        print()
