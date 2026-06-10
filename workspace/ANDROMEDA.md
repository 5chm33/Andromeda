# ANDROMEDA.md — Auto-generated at startup (v5.96)
> **THIS FILE IS INJECTED AT THE START OF EVERY SYSTEM PROMPT.**
> Read it completely before taking any action. It contains your real file structure,
> correct tool names, and mandatory protocols.
> Last updated: 2026-06-10T22:24:15.096Z

## ⚠️ CRITICAL: Your Runtime Paths (v5.96)
These are the ACTUAL paths on this machine. Use these in ALL bash_execute commands.

| Path | Value |
|------|-------|
| Project root | `/home/ubuntu/andromeda_repo` |
| Server source | `/home/ubuntu/andromeda_repo/dist` |
| Workspace | `/home/ubuntu/andromeda_repo/workspace` |

**When searching for source files, use:**
```bash
find "/home/ubuntu/andromeda_repo/dist" -name "*.ts" | sort
# OR simply:
ls "/home/ubuntu/andromeda_repo/dist"
```

**NEVER use /app/, /app/src/, /app/server/src/, or C:\Users\ paths — they do NOT exist.**

## ⚠️ IMPORTANT: Your source files are in server/ (NOT src/)
The following is the ACTUAL list of files in your server/ directory as of this startup.
You do NOT need to call any tool to discover these — they are listed here.
To read any of these files, use: self_read_server_file with file_path set to the filename (e.g., "llmProvider.ts").

```

```

## ⚠️ MANDATORY: Read This Before Any File Operation

**YOU ARE ANDROMEDA. Your source files are in `server/`, NOT `src/`.**

This is the single most important fact about your file structure. Every time you
try to read `src/anything`, you will get ENOENT (file not found). Use the table below.

### Path Translation Table (src/ → server/)

| ❌ WRONG PATH (will fail) | ✅ CORRECT PATH (use this) |
|---|---|
| `src/engine/response-stream.ts` | `server/llmProvider.ts` |
| `src/server/streaming/response-stream.ts` | `server/llmProvider.ts` |
| `src/server/llm/provider.ts` | `server/llmProvider.ts` |
| `src/server/agent/engine.ts` | `server/reactEngine.ts` |
| `src/engine/stream.ts` | `server/llmProvider.ts` |
| `src/agent/engine.ts` | `server/reactEngine.ts` |
| `src/agent/tools.ts` | `server/tools/index.ts` |
| `src/index.ts` | `server/_core/index.ts` |
| `src/self-improve/index.ts` | `server/selfImprove.ts` |
| `src/self-improve/continuous-improver.ts` | `server/continuousImprover.ts` |
| `src/self-improve/self-heal.ts` | `server/selfHeal.ts` |
| `src/self-improve/self-monitor.ts` | `server/selfMonitor.ts` |
| `src/self-improve/recursion-guard.ts` | `server/recursionGuard.ts` |
| `src/self-improve/hot-reload.ts` | `server/hotReload.ts` |
| `src/self-improve/autonomy-orchestrator.ts` | `server/autonomyOrchestrator.ts` |
| `src/tools/` | `server/tools/` |
| `src/memory/` | `server/memory.ts` |
| `src/monitoring/` | `server/selfMonitor.ts` |
| `src/llm/provider.ts` | `server/llmProvider.ts` |
| `src/llm/stream.ts` | `server/llmProvider.ts` |
| `src/constitution.ts` | `server/safetySupervisor.ts` |
| `src/db/` | `server/db/` |

**Rule: If you want to read a file, ALWAYS use `self_read_server_file` with just the filename
(e.g., `self_read_server_file("llmProvider.ts")`) — it resolves automatically from server/.**

**STOP if you get ENOENT twice on the same path — the file does not exist. Use `bash_execute`
with `find server/ -name "*.ts" | head -50` to discover the real file tree.**


## Andromeda Architecture

### Entry Point
- `server/_core/index.ts` — Express server, startup, all daemon initialization

### Core Engine
- `server/reactEngine.ts` — Main ReAct agent loop (think → tool → observe → repeat)
- `server/ai.ts` — LLM API calls, system prompt builder, token counting
- `server/llmProvider.ts` — Streaming completion, finish_reason:length continuation (v5.77: also detects finish_reason:stop-but-truncated via detectOutputTruncation, 32768 tokens, tool-arg repair, 5 continuations)
- `server/streamRouter.ts` — HTTP streaming endpoint, tool dispatch

### Self-Modification Pipeline
- `server/twoPhaseCommit.ts` — Atomic file write with git snapshot + SHA-256 verify + rollback + truncation detection
- `server/tools/selfModifyTools.ts` — self_write_file, self_patch_file, self_read_server_file, self_restart
- `server/safetySupervisor.ts` — Constitution enforcement, validates proposals before applying
- `server/autoRollback.ts` — Automatic rollback on degradation
- `server/rsiEngine.ts` — RSI (Recursive Self-Improvement) orchestrator with 8-phase OODA cycle

### Memory & Knowledge
- `server/memory.ts` — Store/retrieve memories (SQLite-backed, cross-session episodic memory)
- `server/tieredContextManager.ts` — Context window management, compression
- `server/unifiedKnowledge.ts` — Cross-module knowledge retrieval

### Self-Awareness
- `server/tools/selfAwareness.ts` — get_own_capabilities, list_codebase_files, run_self_diagnosis, get_system_context
- `server/tools/selfDiagnoseTools.ts` — self_diagnose, self_review, self_benchmark, self_generate_tests
- `server/selfMonitor.ts` — Performance metrics, error rate tracking
- `server/selfHeal.ts` — Proactive health monitoring and auto-repair
- `server/identityManifest.ts` — Identity continuity verification

### Autonomy Daemons
- `server/continuousImprover.ts` — Periodic self-improvement proposals
- `server/autonomyOrchestrator.ts` — Orchestrates improvement cycles
- `server/codebaseAnalyzer.ts` — Code quality analysis
- `server/selfReflectionEngine.ts` — Periodic self-reflection

### Tools Directory (`server/tools/`)
- `fileOps.ts` — read_file, write_file, list_directory, str_replace, read_file_range
- `advancedFileOps.ts` — edit_file, append_file, search_files, move_file, read_file_lines, project_context, tree_view, delete_file
- `selfModifyTools.ts` — self_write_file, self_patch_file, self_read_server_file, self_restart, self_write_file_chunked, self_diff, verify_file_integrity
- `selfAwareness.ts` — get_own_capabilities, run_self_diagnosis, get_system_context, list_codebase_files
- `selfDiagnoseTools.ts` — self_diagnose, self_review, self_benchmark, self_generate_tests
- `selfTestRunner.ts` — run_self_tests, run_type_check, self_heal
- `atomicModifyTools.ts` — self_atomic_modify
- `agentMemory.ts` — store_memory, recall_memory, list_memories
- `agentControl.ts` — ask_human, terminate, create_plan
- `bashExecute.ts` — bash_execute
- `pythonExecute.ts` — python_execute
- `webSearch.ts` — web_search
- `webBrowse.ts` — web_browse
- `gitOps.ts` — git_operations
- `browserAutomation.ts` — browser_navigate, browser_click, browser_type, browser_scroll, browser_extract, browser_execute_js, browser_wait
- `vision.ts` — screenshot, analyze_image, visual_verify
- `dockerSandbox.ts` — sandbox_execute

## Real Server Source Tree (server/)
```
server/
├── _core/
│   └── index.js
├── andromedaDaemon.js
├── data/
│   ├── context_bus.json
│   ├── learned_constraints.json
│   ├── rsi_proof_history.json
│   └── scheduler.json
├── public/
│   ├── .gitkeep
│   ├── __manus__/
│   │   └── debug-collector.js
│   ├── andromeda-icon.png
│   ├── assets/
│   │   ├── KaTeX_AMS-Regular-BQhdFMY1.woff2
│   │   ├── KaTeX_AMS-Regular-DMm9YOAa.woff
│   │   ├── KaTeX_AMS-Regular-DRggAlZN.ttf
│   │   ├── KaTeX_Caligraphic-Bold-ATXxdsX0.ttf
│   │   ├── KaTeX_Caligraphic-Bold-BEiXGLvX.woff
│   │   ├── KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2
│   │   ├── KaTeX_Caligraphic-Regular-CTRA-rTL.woff
│   │   ├── KaTeX_Caligraphic-Regular-Di6jR-x-.woff2
│   │   ├── KaTeX_Caligraphic-Regular-wX97UBjC.ttf
│   │   ├── KaTeX_Fraktur-Bold-BdnERNNW.ttf
│   │   ├── KaTeX_Fraktur-Bold-BsDP51OF.woff
│   │   ├── KaTeX_Fraktur-Bold-CL6g_b3V.woff2
│   │   ├── KaTeX_Fraktur-Regular-CB_wures.ttf
│   │   ├── KaTeX_Fraktur-Regular-CTYiF6lA.woff2
│   │   ├── KaTeX_Fraktur-Regular-Dxdc4cR9.woff
│   │   ├── KaTeX_Main-Bold-Cx986IdX.woff2
│   │   ├── KaTeX_Main-Bold-Jm3AIy58.woff
│   │   ├── KaTeX_Main-Bold-waoOVXN0.ttf
│   │   ├── KaTeX_Main-BoldItalic-DxDJ3AOS.woff2
│   │   ├── KaTeX_Main-BoldItalic-DzxPMmG6.ttf
│   │   ├── KaTeX_Main-BoldItalic-SpSLRI95.woff
│   │   ├── KaTeX_Main-Italic-3WenGoN9.ttf
│   │   ├── KaTeX_Main-Italic-BMLOBm91.woff
│   │   ├── KaTeX_Main-Italic-NWA7e6Wa.woff2
│   │   ├── KaTeX_Main-Regular-B22Nviop.woff2
│   │   ├── KaTeX_Main-Regular-Dr94JaBh.woff
│   │   ├── KaTeX_Main-Regular-ypZvNtVU.ttf
│   │   ├── KaTeX_Math-BoldItalic-B3XSjfu4.ttf
│   │   ├── KaTeX_Math-BoldItalic-CZnvNsCZ.woff2
│   │   ├── KaTeX_Math-BoldItalic-iY-2wyZ7.woff
│   │   ├── KaTeX_Math-Italic-DA0__PXp.woff
│   │   ├── KaTeX_Math-Italic-flOr_0UB.ttf
│   │   ├── KaTeX_Math-Italic-t53AETM-.woff2
│   │   ├── KaTeX_SansSerif-Bold-CFMepnvq.ttf
│   │   ├── KaTeX_SansSerif-Bold-D1sUS0GD.woff2
│   │   ├── KaTeX_SansSerif-Bold-DbIhKOiC.woff
│   │   ├── KaTeX_SansSerif-Italic-C3H0VqGB.woff2
│   │   ├── KaTeX_SansSerif-Italic-DN2j7dab.woff
│   │   ├── KaTeX_SansSerif-Italic-YYjJ1zSn.ttf
│   │   ├── KaTeX_SansSerif-Regular-BNo7hRIc.ttf
│   │   ├── KaTeX_SansSerif-Regular-CS6fqUqJ.woff
│   │   ├── KaTeX_SansSerif-Regular-DDBCnlJ7.woff2
│   │   ├── KaTeX_Script-Regular-C5JkGWo-.ttf
│   │   ├── KaTeX_Script-Regular-D3wIWfF6.woff2
│   │   ├── KaTeX_Script-Regular-D5yQViql.woff
│   │   ├── KaTeX_Size1-Regular-C195tn64.woff
│   │   ├── KaTeX_Size1-Regular-Dbsnue_I.ttf
│   │   ├── KaTeX_Size1-Regular-mCD8mA8B.woff2
│   │   ├── KaTeX_Size2-Regular-B7gKUWhC.ttf
│   │   ├── KaTeX_Size2-Regular-Dy4dx90m.woff2
│   │   ├── KaTeX_Size2-Regular-oD1tc_U0.woff
│   │   ├── KaTeX_Size3-Regular-CTq5MqoE.woff
│   │   ├── KaTeX_Size3-Regular-DgpXs0kz.ttf
│   │   ├── KaTeX_Size4-Regular-BF-4gkZK.woff
│   │   ├── KaTeX_Size4-Regular-DWFBv043.ttf
│   │   ├── KaTeX_Size4-Regular-Dl5lxZxV.woff2
│   │   ├── KaTeX_Typewriter-Regular-C0xS9mPB.woff
│   │   ├── KaTeX_Typewriter-Regular-CO6r4hn1.woff2
│   │   ├── KaTeX_Typewriter-Regular-D3Ib7_Hf.ttf
│   │   ├── ProposalTreeGraph-C5ap-Sga.css
│   │   ├── ProposalTreeGraph-D1VrEQzk.js
│   │   ├── _basePickBy-DDpOgqBZ.js
│   │   ├── _baseUniq-Bf_T49z8.js
│   │   ├── abap-BdImnpbu.js
│   │   ├── actionscript-3-CfeIJUat.js
│   │   ├── ada-bCR0ucgS.js
│   │   ├── andromeeda-C-Jbm3Hp.js
│   │   ├── angular-html-CU67Zn6k.js
│   │   ├── angular-ts-BwZT4LLn.js
│   │   ├── apache-Pmp26Uib.js
│   │   ├── apex-C7Pw0Ztw.js
│   │   ├── apl-dKokRX4l.js
│   │   ├── applescript-Co6uUVPk.js
│   │   ├── ara-BRHolxvo.js
│   │   ├── arc-oJVs6EQJ.js
│   │   ├── architectureDiagram-VXUJARFQ-DlaTNkTF.js
│   │   ├── asciidoc-Dv7Oe6Be.js
│   │   ├── asm-D_Q5rh1f.js
│   │   ├── astro-CbQHKStN.js
│   │   ├── aurora-x-D-2ljcwZ.js
│   │   ├── awk-DMzUqQB5.js
│   │   ├── ayu-dark-Cv9koXgw.js
│   │   ├── ballerina-BFfxhgS-.js
│   │   ├── bat-BkioyH1T.js
│   │   ├── beancount-k_qm7-4y.js
│   │   ├── berry-D08WgyRC.js
│   │   ├── bibtex-CHM0blh-.js
│   │   ├── bicep-6nHXG8SA.js
│   │   ├── blade-DVc8C-J4.js
│   │   ├── blockDiagram-VD42YOAC-DUZN9XZ0.js
│   │   ├── bsl-BO_Y6i37.js
│   │   ├── c-BIGW1oBm.js
│   │   ├── c4Diagram-YG6GDRKO-Q7DAcU2H.js
│   │   ├── cadence-Bv_4Rxtq.js
│   │   ├── cairo-KRGpt6FW.js
│   │   ├── catppuccin-frappe-DFWUc33u.js
│   │   ├── catppuccin-latte-C9dUb6Cb.js
│   │   ├── catppuccin-macchiato-DQyhUUbL.js
│   │   ├── catppuccin-mocha-D87Tk5Gz.js
│   │   ├── channel-CRBn3x0u.js
│   │   ├── chunk-4BX2VUAB-B9pqymrF.js
│   │   ├── chunk-55IACEB6-CQ1bVCZe.js
│   │   ├── chunk-B4BG7PRW-Z6Znt9St.js
│   │   ├── chunk-DI55MBZ5-BUOFH8aN.js
│   │   ├── chunk-FMBD7UC4-X6k6JvIa.js
│   │   ├── chunk-QN33PNHL-ClqzsH3i.js
│   │   ├── chunk-QZHKN3VN-_RP517zK.js
│   │   ├── chunk-TZMSLE5B-Bo3Lri9V.js
│   │   ├── clarity-D53aC0YG.js
│   │   ├── classDiagram-2ON5EDUG-DXrjfdDa.js
│   │   ├── classDiagram-v2-WZHVMYZB-DXrjfdDa.js
│   │   ├── clojure-P80f7IUj.js
│   │   ├── clone-CUvK3ATd.js
│   │   ├── cmake-D1j8_8rp.js
│   │   ├── cobol-nwyudZeR.js
│   │   ├── codeowners-Bp6g37R7.js
│   │   ├── codeql-DsOJ9woJ.js
│   │   ├── coffee-Ch7k5sss.js
│   │   ├── common-lisp-Cg-RD9OK.js
│   │   ├── coq-DkFqJrB1.js
│   │   ├── cose-bilkent-S5V4N54A-DbmUYjAD.js
│   │   ├── cpp-CofmeUqb.js
│   │   ├── crystal-tKQVLTB8.js
│   │   ├── csharp-CX12Zw3r.js
│   │   ├── css-DPfMkruS.js
│   │   ├── csv-fuZLfV_i.js
│   │   ├── cue-D82EKSYY.js
│   │   ├── cypher-COkxafJQ.js
│   │   ├── cytoscape.esm-DtBltrT8.js
│   │   ├── d-85-TOEBH.js
│   │   ├── dagre-6UL2VRFP-BMLgGrvK.js
│   │   ├── dark-plus-eOWES_5F.js
│   │   ├── dart-CF10PKvl.js
│   │   ├── dax-CEL-wOlO.js
│   │   ├── desktop-BmXAJ9_W.js
│   │   ├── diagram-PSM6KHXK-jP-AoFNp.js
│   │   ├── diagram-QEK2KX5R-Bz9LnJL-.js
│   │   ├── diagram-S2PKOQOG-Dx36tRUG.js
│   │   ├── diff-D97Zzqfu.js
│   │   ├── docker-BcOcwvcX.js
│   │   ├── dotenv-Da5cRb03.js
│   │   ├── dracula-BzJJZx-M.js
│   │   ├── dracula-soft-BXkSAIEj.js
│   │   ├── dream-maker-BtqSS_iP.js
│   │   ├── edge-BkV0erSs.js
│   │   ├── elixir-CDX3lj18.js
│   │   ├── elm-DbKCFpqz.js
│   │   ├── emacs-lisp-C9XAeP06.js
│   │   ├── erDiagram-Q2GNP2WA-CmkGM83K.js
│   │   ├── erb-BOJIQeun.js
│   │   ├── erlang-DsQrWhSR.js
│   │   ├── everforest-dark-BgDCqdQA.js
│   │   ├── everforest-light-C8M2exoo.js
│   │   ├── fennel-BYunw83y.js
│   │   ├── fish-BvzEVeQv.js
│   │   ├── flowDiagram-NV44I4VS-BHNU3TYs.js
│   │   ├── fluent-C4IJs8-o.js
│   │   ├── fortran-fixed-form-BZjJHVRy.js
│   │   ├── fortran-free-form-D22FLkUw.js
│   │   ├── fsharp-CXgrBDvD.js
│   │   ├── ganttDiagram-LVOFAZNH-QQcyJQIK.js
│   │   ├── gdresource-B7Tvp0Sc.js
│   │   ├── gdscript-DTMYz4Jt.js
│   │   ├── gdshader-DkwncUOv.js
│   │   ├── genie-D0YGMca9.js
│   │   ├── gherkin-DyxjwDmM.js
│   │   ├── git-commit-F4YmCXRG.js
│   │   ├── git-rebase-r7XF79zn.js
│   │   ├── gitGraphDiagram-NY62KEGX-eQx448j1.js
│   │   ├── github-dark-DHJKELXO.js
│   │   ├── github-dark-default-Cuk6v7N8.js
│   │   ├── github-dark-dimmed-DH5Ifo-i.js
│   │   ├── github-dark-high-contrast-E3gJ1_iC.js
│   │   ├── github-light-DAi9KRSo.js
│   │   ├── github-light-default-D7oLnXFd.js
│   │   ├── github-light-high-contrast-BfjtVDDH.js
│   │   ├── gleam-BspZqrRM.js
│   │   ├── glimmer-js-Rg0-pVw9.js
│   │   ├── glimmer-ts-U6CK756n.js
│   │   ├── glsl-DplSGwfg.js
│   │   ├── gnuplot-DdkO51Og.js
│   │   ├── go-Dn2_MT6a.js
│   │   ├── graph-DCc_QGUT.js
│   │   ├── graphql-ChdNCCLP.js
│   │   ├── groovy-gcz8RCvz.js
│   │   ├── gruvbox-dark-hard-CFHQjOhq.js
│   │   ├── gruvbox-dark-medium-GsRaNv29.js
│   │   ├── gruvbox-dark-soft-CVdnzihN.js
│   │   ├── gruvbox-light-hard-CH1njM8p.js
│   │   ├── gruvbox-light-medium-DRw_LuNl.js
│   │   ├── gruvbox-light-soft-hJgmCMqR.js
│   │   ├── hack-CaT9iCJl.js
│   │   ├── haml-B8DHNrY2.js
│   │   ├── handlebars-BL8al0AC.js
│   │   ├── haskell-Df6bDoY_.js
│   │   ├── haxe-CzTSHFRz.js
│   │   ├── hcl-BWvSN4gD.js
│   │   ├── hjson-D5-asLiD.js
│   │   ├── hlsl-D3lLCCz7.js
│   │   ├── houston-DnULxvSX.js
│   │   ├── html-GMplVEZG.js
│   │   ├── html-derivative-BFtXZ54Q.js
│   │   ├── http-jrhK8wxY.js
│   │   ├── hurl-irOxFIW8.js
│   │   ├── hxml-Bvhsp5Yf.js
│   │   ├── hy-DFXneXwc.js
│   │   ├── imba-DGztddWO.js
│   │   ├── index-CRUZJeyA.js
│   │   ├── index-IQYqYSVj.css
│   │   ├── infoDiagram-F6ZHWCRC-DbWbstRZ.js
│   │   ├── ini-BEwlwnbL.js
│   │   ├── java-CylS5w8V.js
│   │   ├── javascript-wDzz0qaB.js
│   │   ├── jinja-4LBKfQ-Z.js
│   │   ├── jison-wvAkD_A8.js
│   │   ├── journeyDiagram-XKPGCS4Q-BXDps9Y5.js
│   │   ├── json-Cp-IABpG.js
│   │   ├── json5-C9tS-k6U.js
│   │   ├── jsonc-Des-eS-w.js
│   │   ├── jsonl-DcaNXYhu.js
│   │   ├── jsonnet-DFQXde-d.js
│   │   ├── jssm-C2t-YnRu.js
│   │   ├── jsx-g9-lgVsj.js
│   │   ├── julia-C8NyazO9.js
│   │   ├── kanagawa-dragon-CkXjmgJE.js
│   │   ├── kanagawa-lotus-CfQXZHmo.js
│   │   ├── kanagawa-wave-DWedfzmr.js
│   │   ├── kanban-definition-3W4ZIXB7-QTwMYs5i.js
│   │   ├── kdl-DV7GczEv.js
│   │   ├── kotlin-BdnUsdx6.js
│   │   ├── kusto-BvAqAH-y.js
│   │   ├── laserwave-DUszq2jm.js
│   │   ├── latex-BUKiar2Z.js
│   │   ├── layout-BIKmHydI.js
│   │   ├── lean-DP1Csr6i.js
│   │   ├── less-B1dDrJ26.js
│   │   ├── light-plus-B7mTdjB0.js
│   │   ├── liquid-DYVedYrR.js
│   │   ├── llvm-BtvRca6l.js
│   │   ├── log-2UxHyX5q.js
│   │   ├── logo-BtOb2qkB.js
│   │   ├── lua-BbnMAYS6.js
│   │   ├── luau-CXu1NL6O.js
│   │   ├── make-CHLpvVh8.js
│   │   ├── markdown-Cvjx9yec.js
│   │   ├── marko-CPi9NSCl.js
│   │   ├── material-theme-D5KoaKCx.js
│   │   ├── material-theme-darker-BfHTSMKl.js
│   │   ├── material-theme-lighter-B0m2ddpp.js
│   │   ├── material-theme-ocean-CyktbL80.js
│   │   ├── material-theme-palenight-Csfq5Kiy.js
│   │   ├── matlab-D7o27uSR.js
│   │   ├── mdc-DUICxH0z.js
│   │   ├── mdx-Cmh6b_Ma.js
│   │   ├── mermaid-DKYwYmdq.js
│   │   ├── mermaid.core-_gNyaZCx.js
│   │   ├── min-dark-CafNBF8u.js
│   │   ├── min-light-CTRr51gU.js
│   │   ├── mindmap-definition-VGOIOE7T-BGamIb29.js
│   │   ├── mipsasm-CKIfxQSi.js
│   │   ├── mojo-1DNp92w6.js
│   │   ├── monokai-D4h5O-jR.js
│   │   ├── move-Bu9oaDYs.js
│   │   ├── narrat-DRg8JJMk.js
│   │   ├── nextflow-CUEJCptM.js
│   │   ├── nginx-DknmC5AR.js
│   │   ├── night-owl-C39BiMTA.js
│   │   ├── nim-CVrawwO9.js
│   │   ├── nix-BbRYJGeE.js
│   │   ├── nord-Ddv68eIx.js
│   │   ├── nushell-C-sUppwS.js
│   │   ├── objective-c-DXmwc3jG.js
│   │   ├── objective-cpp-CLxacb5B.js
│   │   ├── ocaml-C0hk2d4L.js
│   │   ├── one-dark-pro-DVMEJ2y_.js
│   │   ├── one-light-PoHY5YXO.js
│   │   ├── pascal-D93ZcfNL.js
│   │   ├── perl-C0TMdlhV.js
│   │   ├── php-CDn_0X-4.js
│   │   ├── pieDiagram-ADFJNKIX-Rgplj53e.js
│   │   ├── pkl-u5AG7uiY.js
│   │   ├── plastic-3e1v2bzS.js
│   │   ├── plsql-ChMvpjG-.js
│   │   ├── po-BTJTHyun.js
│   │   ├── poimandres-CS3Unz2-.js
│   │   ├── polar-C0HS_06l.js
│   │   ├── postcss-CXtECtnM.js
│   │   ├── powerquery-CEu0bR-o.js
│   │   ├── powershell-Dpen1YoG.js
│   │   ├── prisma-Dd19v3D-.js
│   │   ├── prolog-CbFg5uaA.js
│   │   ├── proto-DyJlTyXw.js
│   │   ├── pug-CGlum2m_.js
│   │   ├── puppet-BMWR74SV.js
│   │   ├── purescript-CklMAg4u.js
│   │   ├── python-B6aJPvgy.js
│   │   ├── qml-3beO22l8.js
│   │   ├── qmldir-C8lEn-DE.js
│   │   ├── qss-IeuSbFQv.js
│   │   ├── quadrantDiagram-AYHSOK5B-CdODTAZv.js
│   │   ├── r-DiinP2Uv.js
│   │   ├── racket-BqYA7rlc.js
│   │   ├── raku-DXvB9xmW.js
│   │   ├── razor-WgofotgN.js
│   │   ├── red-bN70gL4F.js
│   │   ├── reg-C-SQnVFl.js
│   │   ├── regexp-CDVJQ6XC.js
│   │   ├── rel-C3B-1QV4.js
│   │   ├── requirementDiagram-UZGBJVZJ-Cq_R67Ry.js
│   │   ├── riscv-BM1_JUlF.js
│   │   ├── rose-pine-BHrmToEH.js
│   │   ├── rose-pine-dawn-CnK8MTSM.js
│   │   ├── rose-pine-moon-NleAzG8P.js
│   │   ├── rosmsg-BJDFO7_C.js
│   │   ├── rst-B0xPkSld.js
│   │   ├── ruby-BvKwtOVI.js
│   │   ├── rust-B1yitclQ.js
│   │   ├── sankeyDiagram-TZEHDZUN-B7mx8Fmc.js
│   │   ├── sas-cz2c8ADy.js
│   │   ├── sass-Cj5Yp3dK.js
│   │   ├── scala-C151Ov-r.js
│   │   ├── scheme-C98Dy4si.js
│   │   ├── scss-OYdSNvt2.js
│   │   ├── sdbl-DVxCFoDh.js
│   │   ├── sequenceDiagram-WL72ISMW-C0G1Q1wh.js
│   │   ├── shaderlab-Dg9Lc6iA.js
│   │   ├── shellscript-Yzrsuije.js
│   │   ├── shellsession-BADoaaVG.js
│   │   ├── slack-dark-BthQWCQV.js
│   │   ├── slack-ochin-DqwNpetd.js
│   │   ├── smalltalk-BERRCDM3.js
│   │   ├── snazzy-light-Bw305WKR.js
│   │   ├── solarized-dark-DXbdFlpD.js
│   │   ├── solarized-light-L9t79GZl.js
│   │   ├── solidity-BbcW6ACK.js
│   │   ├── soy-Brmx7dQM.js
│   │   ├── sparql-rVzFXLq3.js
│   │   ├── splunk-BtCnVYZw.js
│   │   ├── sql-BLtJtn59.js
│   │   ├── ssh-config-_ykCGR6B.js
│   │   ├── stata-BH5u7GGu.js
│   │   ├── stateDiagram-FKZM4ZOC-I9zancNg.js
│   │   ├── stateDiagram-v2-4FDKWEC3-DLzfQGQk.js
│   │   ├── stylus-BEDo0Tqx.js
│   │   ├── svelte-3Dk4HxPD.js
│   │   ├── swift-Dg5xB15N.js
│   │   ├── synthwave-84-CbfX1IO0.js
│   │   ├── system-verilog-CnnmHF94.js
│   │   ├── systemd-4A_iFExJ.js
│   │   ├── talonscript-CkByrt1z.js
│   │   ├── tasl-QIJgUcNo.js
│   │   ├── tcl-dwOrl1Do.js
│   │   ├── templ-W15q3VgB.js
│   │   ├── terraform-BETggiCN.js
│   │   ├── tex-Cppo0RY3.js
│   │   ├── timeline-definition-IT6M3QCI-BTO_K79U.js
│   │   ├── tokyo-night-hegEt444.js
│   │   ├── toml-vGWfd6FD.js
│   │   ├── transform-BMxpUt82.js
│   │   ├── treemap-KMMF4GRG-GgY1xQzp.js
│   │   ├── ts-tags-zn1MmPIZ.js
│   │   ├── tsv-B_m7g4N7.js
│   │   ├── tsx-COt5Ahok.js
│   │   ├── turtle-BsS91CYL.js
│   │   ├── twig-CO9l9SDP.js
│   │   ├── typescript-BPQ3VLAy.js
│   │   ├── typespec-Df68jz8_.js
│   │   ├── typst-DHCkPAjA.js
│   │   ├── v-BcVCzyr7.js
│   │   ├── vala-CsfeWuGM.js
│   │   ├── vb-D17OF-Vu.js
│   │   ├── verilog-BQ8w6xss.js
│   │   ├── vesper-DU1UobuO.js
│   │   ├── vhdl-CeAyd5Ju.js
│   │   ├── viml-CJc9bBzg.js
│   │   ├── vitesse-black-Bkuqu6BP.js
│   │   ├── vitesse-dark-D0r3Knsf.js
│   │   ├── vitesse-light-CVO1_9PV.js
│   │   ├── vue-CCoi5OLL.js
│   │   ├── vue-html-DAAvJJDi.js
│   │   ├── vue-vine-_Ih-lPRR.js
│   │   ├── vyper-CDx5xZoG.js
│   │   ├── wasm-CG6Dc4jp.js
│   │   ├── wasm-MzD3tlZU.js
│   │   ├── wenyan-BV7otONQ.js
│   │   ├── wgsl-Dx-B1_4e.js
│   │   ├── wikitext-BhOHFoWU.js
│   │   ├── wit-5i3qLPDT.js
│   │   ├── wolfram-lXgVvXCa.js
│   │   ├── xml-sdJ4AIDG.js
│   │   ├── xsl-CtQFsRM5.js
│   │   ├── xychartDiagram-PRI3JC2R-H1_CzeCi.js
│   │   ├── yaml-Buea-lGh.js
│   │   ├── zenscript-DVFEvuxE.js
│   │   └── zig-VOosw3JB.js
│   ├── index.html
│   └── skins/
│       ├── andromeda_default.jpg
│       ├── aurora.jpg
│       ├── aurora_2.jpg
│       ├── cyberpunk.jpg
│       ├── cyberpunk_2.jpg
│       ├── finalfantasy.jpg
│       ├── finalfantasy_2.jpg
│       ├── goth.jpg
│       ├── goth_2.jpg
│       ├── lofi.jpg
│       ├── lofi_2.jpg
│       ├── lofi_new.jpg
│       ├── luigis_mansion.jpg
│       ├── luigis_mansion_2.jpg
│       ├── luigis_mansion_new.jpg
│       ├── monsters.jpg
│       ├── monsters_2.jpg
│       ├── nature_forest.jpg
│       ├── nature_forest_2.jpg
│       ├── overlays/
│       │   ├── aurora_particles.png
│       │   ├── cyberpunk_rain.png
│       │   ├── goth_bats.png
│       │   ├── lofi_rain.png
│       │   ├── luigi_ghost.png
│       │   └── nature_fog.png
│       ├── space.jpg
│       ├── space_2.jpg
│       ├── stealth.jpg
│       └── videos/
│           ├── aurora.mp4
│           ├── cyberpunk.mp4
│           ├── finalfantasy.mp4
│           ├── goth.mp4
│           ├── lofi.mp4
│           ├── luigis_mansion.mp4
│           ├── monsters.mp4
│           ├── nature.mp4
│           └── space.mp4
└── workspace/
    ├── .andromeda_knowledge_base.json
    ├── .andromeda_memory.json
    ├── .andromeda_meta_goals.json
    ├── .andromeda_proposal_cache.json
    ├── .pipeline_backups/
    │   ├── rsi-typecheck_1781063770714.json
    │   └── rsi-typecheck_1781063780921.json
    ├── .rollback_history/
    │   ├── rp_1781062581215_6m4jsp.json
    │   ├── rp_1781062619071_gy18y7.json
    │   ├── rp_1781062637969_re5d4w.json
    │   ├── rp_1781062912827_vfwzbl.json
    │   ├── rp_1781062929423_0tyz8c.json
    │   ├── rp_1781062929450_azbqmb.json
    │   ├── rp_1781063188529_9ayk0s.json
    │   ├── rp_1781063237516_wt6aix.json
    │   ├── rp_1781063283539_0jipdd.json
    │   ├── rp_1781064681923_dny9o6.json
    │   ├── rp_1781064893291_7r2zpv.json
    │   ├── rp_1781064972369_26qgds.json
    │   ├── rp_1781065039720_s560j5.json
    │   ├── rp_1781129434110_cos44v.json
    │   ├── rp_1781129434171_y0i6ov.json
    │   ├── rp_1781129434225_vpqlp7.json
    │   ├── rp_1781129809405_byhsha.json
    │   ├── rp_1781129849184_uv4rly.json
    │   └── rp_1781129849461_jnman6.json
    └── rsi-history.jsonl
```

## Available Tools (EXACT names — verified against source code)

### Self-Modification (use these for reading/writing your own source code)
- `self_read_server_file` — Read an Andromeda server source file with line numbers. Args: `file_path` (relative to server/, e.g. "llmProvider.ts"), optional `start_line`, `end_line`
- `self_read_file` — Alias for self_read_server_file. Same args.
- `self_patch_file` — Apply a targeted find-and-replace patch (PREFERRED for edits < 50 lines)
- `self_write_file` — Write a complete file (only for new files or full rewrites < 3000 chars)
- `self_write_file_chunked` — Write large files in chunks (required for files > 3000 chars)
- `self_restart` — Restart the server to apply changes
- `run_type_check` — Run TypeScript check after a self-modification. Alias: `self_run_tests` (both work as of v5.77)
- `self_diagnose` — Run root-cause analysis before modifying (ALWAYS do this first)
- `self_review` — Multi-dimensional pre-apply review (security, truncation, constitution)
- `self_benchmark` — Record/check performance baseline before and after changes
- `self_diff` — Show diff between two versions of a file
- `self_atomic_modify` — Atomic multi-file modification with rollback
- `verify_file_integrity` — Verify SHA-256 hash of a file

### Self-Awareness
- `get_own_capabilities` — Get capabilities, feature flags, and system state
- `list_codebase_files` — List all server source files with descriptions (NOT "get_codebase_map")
- `get_system_context` — Get current system context and environment
- `run_self_diagnosis` — Run comprehensive self-diagnosis (NOT "self_awareness")
- `self_heal` — Trigger self-healing routine

### File Operations (workspace files only — NOT for Andromeda source)
- `read_file` — Read a workspace file (uses workspace-relative paths)
- `read_file_range` — Read a specific line range of a workspace file
- `read_file_lines` — Read specific lines from a workspace file
- `write_file` — Write a workspace file
- `edit_file` — Edit a workspace file with find-and-replace
- `append_file` — Append to a workspace file
- `str_replace` — String replace in a workspace file
- `list_directory` — List directory contents
- `tree_view` — Show directory tree
- `search_files` — Search for text across files
- `move_file` — Move/rename a file
- `delete_file` — Delete a file
- `project_context` — Get project context summary

### Shell & Code Execution
- `bash_execute` — Execute a shell command (NOT "execute_bash" or "run_shell")
- `python_execute` — Execute Python code
- `sandbox_execute` — Execute code in an isolated sandbox
- `run_self_tests` — Run the self-test suite

### Memory (cross-session episodic memory)
- `store_memory` — Store a memory entry
- `recall_memory` — Search memories by query
- `list_memories` — List all memories

### Web & Search
- `web_search` — Search the web
- `web_browse` — Browse a URL (NOT "fetch_url")

### Git
- `git_operations` — Git operations (commit, diff, log, etc.)

### Vision
- `screenshot` — Take a screenshot
- `analyze_image` — Analyze an image
- `visual_verify` — Visual verification

### Agent Control
- `ask_human` — Ask the human a question
- `create_plan` — Create a structured plan
- `terminate` — End the current task

## CRITICAL: Self-Modification Workflow for Large Files (v5.82)

The truncation circular dependency is ALREADY SOLVED. Here is the exact workflow:

**Step 1**: Read the file first: `self_read_server_file("llmProvider.ts")`
**Step 2**: For edits < 50 lines: use `self_patch_file` (preferred — never truncated)
**Step 3**: For new files or full rewrites > 3000 chars: use `self_write_file_chunked`
  - Args: `file_path`, `chunk_index` (0-based), `total_chunks`, `content`
  - Send chunk 0, then chunk 1, etc. The system assembles them automatically.
  - Example: 300-line file = 3 chunks of 100 lines each
**Step 4**: Run `run_type_check` to verify
**Step 5**: Run `self_restart` if TypeScript check passes

**NEVER use `self_write_file` for files > 3000 chars** — it will be rejected.
**ALWAYS use `self_patch_file` for targeted edits** — it cannot be truncated.

## CRITICAL: Wrong tool names that will FAIL
| ❌ DO NOT USE (does not exist) | ✅ USE INSTEAD |
|---|---|
| `self_awareness` | `get_own_capabilities` or `run_self_diagnosis` |
| `get_codebase_map` | `list_codebase_files` |
| `list_files` | `list_directory` or `tree_view` |
| `read_file_content` | `self_read_server_file` (source) or `read_file` (workspace) |
| `execute_bash` | `bash_execute` |
| `run_shell` | `bash_execute` |
| `self_test_runner` | `run_type_check` |
| ~~`self_run_tests`~~ | Both `self_run_tests` and `run_type_check` work as of v5.77 |
| `fetch_url` | `web_browse` |
| `run_code` | `bash_execute` or `python_execute` |
| `truncation_fix` | Does not exist — see llmProvider.ts |
| `self_read_file` | `self_read_server_file` (alias also works) |


## Constitution (Hard Rules — Cannot Be Overridden)

These rules are enforced by `server/safetySupervisor.ts` and checked by `self_review`:

1. **NEVER delete or overwrite twoPhaseCommit.ts, safetySupervisor.ts, or recursionGuard.ts** — these are the safety systems
2. **NEVER remove rollback logic** — any modification that removes git snapshot or SHA-256 verification will be rejected
3. **NEVER add process.exit(), eval(), or shell injection** — these are security violations
4. **ALWAYS use self_patch_file for edits to existing files** — full rewrites risk truncation
5. **ALWAYS run run_type_check after any self-modification** — no untested changes
6. **ALWAYS store the outcome in memory** — use store_memory with type='success' or type='failure'
7. **Maximum 3 auto-applies per RSI cycle** — prevents runaway modification
8. **Pause after 9 consecutive auto-applies** — requires human confirmation

## Cross-Session Episodic Memory Protocol

After EVERY self-modification attempt, store the outcome:
```
store_memory({
  type: "success" | "failure",
  content: "Fixed truncation in llmProvider.ts: increased max_tokens from 8192 to 32768. Root cause: output token limit too low for large file writes.",
  tags: ["self-modification", "llmProvider.ts", "truncation"]
})
```
Before attempting any fix, ALWAYS call:
```
recall_memory("truncation fix llmProvider")
```
This prevents repeating the same mistakes across sessions.

## ENOENT Loop Prevention (v5.76)

If `read_file` or `self_read_server_file` returns "File not found" or ENOENT:
1. **DO NOT retry the same path** — it will fail again
2. Use `bash_execute` with `find server/ -name "*.ts" | sort` to see all real files
3. Use `list_codebase_files` to get a description of each file
4. The reactEngine will HALT your loop after 3 consecutive ENOENT errors on the same path

## Self-Modification Workflow (MANDATORY — follow exactly)
1. Call `recall_memory` to check if this issue has been seen before
2. Call `self_diagnose` to identify root cause from actual source files
3. Call `self_read_server_file` on the specific file to read the exact current content
4. Plan the MINIMAL change needed (prefer `self_patch_file` over full rewrite)
5. Call `self_review` on the proposed change before applying
6. Apply the change with `self_patch_file` or `self_write_file`
7. Call `run_type_check` to verify TypeScript compiles
8. Call `self_benchmark` to check for performance regression
9. Call `store_memory` with type='success' or type='failure' and the outcome
10. Call `self_restart` to apply the change to the running server

## Current Version
Andromeda v5.96 — Self-modifying AI agent with RSI engine, cross-session episodic memory,
constitution enforcement, three-layer truncation defense, ENOENT loop prevention,
hallucination guard (v5.78), mandatory tool-use enforcement for self-assessments,
and runtime path injection (v5.96) so bash_execute uses real filesystem paths.
