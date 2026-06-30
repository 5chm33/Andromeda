#!/usr/bin/env bash
# ============================================================
# Andromeda SWE-bench Runner
# Runs Verified (500 tasks) then Full (2294 tasks) if successful
# All output logged to /tmp/swebench_runner.log
# ============================================================
set -euo pipefail

LOG=/tmp/swebench_runner.log
AGENT=~/swebench_sota_agent_v3.py
VENV=~/swebench-env
ANDROMEDA=~/andromeda
RESULTS=$ANDROMEDA/data/swebench
GITHUB_TOKEN="${GITHUB_TOKEN}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }
die() { log "FATAL: $*"; exit 1; }

log "============================================================"
log "Andromeda SWE-bench Runner — Starting"
log "============================================================"

# ── Activate venv ──────────────────────────────────────────────
source "$VENV/bin/activate" || die "venv not found at $VENV"
log "Python: $(python3 --version)"
log "SWE-bench: $(python3 -c 'import swebench; print(swebench.__version__)')"

# ── Load env ───────────────────────────────────────────────────
if [ -f ~/andromeda_env.local ]; then
    set -a
    source ~/andromeda_env.local 2>/dev/null || true
    set +a
    log "Env loaded from ~/andromeda_env.local"
fi

# ── Ensure results dir exists ──────────────────────────────────
mkdir -p "$RESULTS"

# ── Run SWE-bench Verified (500 tasks) ────────────────────────
VERIFIED_RUN="andromeda_verified_$(date +%Y%m%d_%H%M)"
log "Starting SWE-bench Verified (500 tasks) — run_id: $VERIFIED_RUN"
log "Predictions will be saved to: $RESULTS/${VERIFIED_RUN}_predictions.jsonl"
log "Progress committed to GitHub every 50 tasks"
log ""

python3 "$AGENT" --dataset verified --run_id "$VERIFIED_RUN" 2>&1 | tee -a "$LOG"
VERIFIED_EXIT=${PIPESTATUS[0]}

if [ $VERIFIED_EXIT -ne 0 ]; then
    log "WARNING: Verified run exited with code $VERIFIED_EXIT — check log"
else
    log "Verified run complete!"
fi

# ── Count predictions ──────────────────────────────────────────
PRED_FILE="$RESULTS/${VERIFIED_RUN}_predictions.jsonl"
if [ -f "$PRED_FILE" ]; then
    PRED_COUNT=$(wc -l < "$PRED_FILE")
    log "Predictions generated: $PRED_COUNT / 500"
else
    log "WARNING: Predictions file not found"
    PRED_COUNT=0
fi

# ── Run SWE-bench Evaluation Harness on Verified ──────────────
log ""
log "============================================================"
log "Running SWE-bench evaluation harness on Verified predictions"
log "============================================================"

EVAL_DIR="$RESULTS/${VERIFIED_RUN}_eval"
mkdir -p "$EVAL_DIR"

python3 -m swebench.harness.run_evaluation \
    --dataset_name "SWE-bench/SWE-bench_Verified" \
    --split test \
    --predictions_path "$PRED_FILE" \
    --max_workers 2 \
    --run_id "$VERIFIED_RUN" \
    --report_dir "$EVAL_DIR" \
    --cache_level env \
    2>&1 | tee -a "$LOG" || log "WARNING: Evaluation harness exited non-zero"

# ── Parse results ──────────────────────────────────────────────
log ""
log "Evaluation complete. Parsing results..."

# Find the results JSON
RESULTS_JSON=$(find "$EVAL_DIR" -name "*.json" | head -1)
if [ -n "$RESULTS_JSON" ]; then
    python3 -c "
import json, sys
with open('$RESULTS_JSON') as f:
    d = json.load(f)
resolved = d.get('resolved', [])
total = d.get('total_instances', 500)
pct = len(resolved) / total * 100 if total > 0 else 0
print(f'RESOLVED: {len(resolved)} / {total} = {pct:.1f}%')
print(f'Resolved instances: {resolved[:10]}...' if len(resolved) > 10 else f'Resolved: {resolved}')
" 2>/dev/null | tee -a "$LOG" || log "Could not parse results JSON"
fi

# ── Commit final Verified results ─────────────────────────────
log "Committing Verified results to GitHub..."
cd "$ANDROMEDA"
git config user.email "andromeda@swebench.ai"
git config user.name "Andromeda SWE-bench"
git add data/swebench/ 2>/dev/null || true
git commit -m "swebench: Verified run complete — $PRED_COUNT predictions ($VERIFIED_RUN)" 2>/dev/null || true
git push "https://${GITHUB_TOKEN}@github.com/5chm33/Andromeda.git" main 2>/dev/null || true
log "Results committed to GitHub"

# ── Run Full SWE-bench (2294 tasks) ───────────────────────────
log ""
log "============================================================"
log "Starting SWE-bench Full (2294 tasks) — ~48 hours"
log "============================================================"

FULL_RUN="andromeda_full_$(date +%Y%m%d_%H%M)"
log "run_id: $FULL_RUN"

python3 "$AGENT" --dataset full --run_id "$FULL_RUN" 2>&1 | tee -a "$LOG"
FULL_EXIT=${PIPESTATUS[0]}

if [ $FULL_EXIT -ne 0 ]; then
    log "WARNING: Full run exited with code $FULL_EXIT"
else
    log "Full run complete!"
fi

# ── Run evaluation harness on Full ────────────────────────────
FULL_PRED_FILE="$RESULTS/${FULL_RUN}_predictions.jsonl"
FULL_EVAL_DIR="$RESULTS/${FULL_RUN}_eval"
mkdir -p "$FULL_EVAL_DIR"

if [ -f "$FULL_PRED_FILE" ]; then
    FULL_COUNT=$(wc -l < "$FULL_PRED_FILE")
    log "Full predictions: $FULL_COUNT / 2294"

    python3 -m swebench.harness.run_evaluation \
        --dataset_name "SWE-bench/SWE-bench" \
        --split test \
        --predictions_path "$FULL_PRED_FILE" \
        --max_workers 2 \
        --run_id "$FULL_RUN" \
        --report_dir "$FULL_EVAL_DIR" \
        --cache_level env \
        2>&1 | tee -a "$LOG" || log "WARNING: Full evaluation harness exited non-zero"
fi

# ── Final commit ───────────────────────────────────────────────
cd "$ANDROMEDA"
git add data/swebench/ 2>/dev/null || true
git commit -m "swebench: Full run complete — $FULL_RUN" 2>/dev/null || true
git push "https://${GITHUB_TOKEN}@github.com/5chm33/Andromeda.git" main 2>/dev/null || true

log ""
log "============================================================"
log "ALL DONE — check GitHub for results"
log "Verified: $RESULTS/${VERIFIED_RUN}_predictions.jsonl"
log "Full:     $RESULTS/${FULL_RUN}_predictions.jsonl"
log "============================================================"
