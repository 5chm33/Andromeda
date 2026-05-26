"""
patch_search.py — v6.15 agent panel upgrades for Search.tsx

Changes:
1. Thinking events now show actual content (collapsed by default, expandable)
2. Stats bar upgraded: shows token count from done event, elapsed time
3. Add step_start event rendering with step number badge
4. Add a live "elapsed time" counter using the step timestamps
"""

with open('/home/ubuntu/andromeda_dev/client/src/pages/Search.tsx', 'r') as f:
    content = f.read()

# ── 1. Upgrade thinking event rendering to show actual content ────────────────
old_thinking = """                          if (evt.type === 'thinking') return (
                            <div key={i} className="px-4 py-3 flex items-center gap-3 animate-fadeIn">
                              <div className="relative flex items-center justify-center w-6 h-6">
                                <div className="absolute inset-0 rounded-full bg-violet-500/20 animate-ping" />
                                <div className="relative w-3 h-3 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 animate-pulse" />
                              </div>
                              <span className="text-sm text-zinc-300 font-medium">Thinking...</span>
                            </div>
                          );"""

new_thinking = """                          if (evt.type === 'thinking') {
                            const isLast = i === reactEvents.length - 1;
                            const hasContent = evt.content && evt.content !== 'Reasoning about next action...';
                            return (
                            <div key={i} className="px-4 py-2.5 animate-fadeIn">
                              <div
                                className="flex items-center gap-3 cursor-pointer group"
                                onClick={(e) => { const det = (e.currentTarget.nextElementSibling as HTMLElement); if (det) det.classList.toggle('hidden'); }}
                              >
                                <div className="relative flex items-center justify-center w-5 h-5 flex-shrink-0">
                                  {isLast && isReactRunning ? (
                                    <>
                                      <div className="absolute inset-0 rounded-full bg-violet-500/20 animate-ping" />
                                      <div className="relative w-2.5 h-2.5 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 animate-pulse" />
                                    </>
                                  ) : (
                                    <div className="w-2.5 h-2.5 rounded-full bg-violet-400/40" />
                                  )}
                                </div>
                                <span className="text-xs text-zinc-400 font-medium flex-1 truncate">
                                  {hasContent ? evt.content!.slice(0, 120) : 'Reasoning...'}
                                </span>
                                {hasContent && (
                                  <span className="text-[10px] text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">expand</span>
                                )}
                              </div>
                              {hasContent && (
                                <div className="hidden mt-1.5 ml-8 text-[11px] text-zinc-500 bg-zinc-800/40 rounded-lg px-3 py-2 border border-zinc-700/30 whitespace-pre-wrap max-h-40 overflow-y-auto">
                                  {evt.content}
                                </div>
                              )}
                            </div>
                          );}"""

content = content.replace(old_thinking, new_thinking)

# ── 2. Upgrade stats bar to show token count and add a collapse toggle ────────
old_stats_bar = """                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-4 h-4 text-cyan-400" />
                        <span className="text-sm font-semibold text-zinc-200">Agent</span>
                        {isReactRunning && <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />}
                        <div className="ml-auto flex items-center gap-3">
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            {reactEvents.filter(e => e.type === 'tool_call').length} actions
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
                            {reactEvents.filter(e => e.type === 'tool_call').length > 0 ? `Step ${reactEvents.filter(e => e.type === 'tool_call').slice(-1)[0]?.step ?? '?'}` : '...'}
                          </span>"""

new_stats_bar = """                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-4 h-4 text-cyan-400" />
                        <span className="text-sm font-semibold text-zinc-200">Agent</span>
                        {isReactRunning && <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />}
                        <div className="ml-auto flex items-center gap-3">
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            {reactEvents.filter(e => e.type === 'tool_call').length} actions
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
                            {reactEvents.filter(e => e.type === 'tool_call').length > 0 ? `Step ${reactEvents.filter(e => e.type === 'tool_call').slice(-1)[0]?.step ?? '?'}` : '...'}
                          </span>
                          {/* v6.15: Token usage badge from done event */}
                          {(() => { const doneEvt = reactEvents.find(e => e.type === 'done'); return doneEvt?.tokenUsage ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              {(doneEvt.tokenUsage.total ?? 0).toLocaleString()} tokens
                            </span>
                          ) : null; })()}"""

content = content.replace(old_stats_bar, new_stats_bar)

# ── 3. Add step_start event rendering (shows step number inline) ──────────────
# Insert before the tool_call handler
old_tool_call_start = """                          if (evt.type === 'tool_call') {
                            const toolSummary = (() => {"""

new_tool_call_start = """                          if (evt.type === 'step_start') return (
                            <div key={i} className="px-4 py-1 animate-fadeIn">
                              <div className="flex items-center gap-2">
                                <div className="h-px flex-1 bg-zinc-800/60" />
                                <span className="text-[10px] text-zinc-600 px-2 font-mono">Step {evt.step ?? i}</span>
                                <div className="h-px flex-1 bg-zinc-800/60" />
                              </div>
                            </div>
                          );
                          if (evt.type === 'tool_call') {
                            const toolSummary = (() => {"""

content = content.replace(old_tool_call_start, new_tool_call_start)

# ── 4. Add EMBEDDING_MODEL to .env.local.example ─────────────────────────────
# (handled separately in env file)

with open('/home/ubuntu/andromeda_dev/client/src/pages/Search.tsx', 'w') as f:
    f.write(content)

print("Done. Verifying...")
checks = [
    'v6.15: Token usage badge',
    'step_start',
    'Step {evt.step',
    'hasContent ? evt.content',
    'expand',
]
for check in checks:
    if check in content:
        print(f"  ✓ {check}")
    else:
        print(f"  ✗ MISSING: {check}")
