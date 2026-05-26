import type { Express } from "express";
import { streamAgentToSSE } from "../reactEngine.js";
import { setActiveProvider } from "../llmProvider.js";
import { getWorkspaceDir } from "../workspace.js";
import type { ReactEngine } from "../reactEngine.js";

/**
 * registerAgentRoutes — Agent/ReAct endpoints extracted from streamRouter.ts (v6.02)
 */
export function registerAgentRoutes(
  app: Express,
  streamLimiter: any,
  heavyLimiter: any,
  setSseHeaders: (res: any) => void,
  sseWrite: (res: any, data: object) => void,
  deps: Record<string, any>
) {
  const activeAgentSessions: Map<string, ReactEngine> = deps.activeAgentSessions;
  // v5.5: ReAct Agent endpoints
  // ═══════════════════════════════════════════════════════════════════════════

  app.post("/api/agent/react/stream", streamLimiter, async (req, res) => {
    const { query, maxSteps, sessionId: clientSessionId } = req.body;
    if (!query) { res.status(400).json({ error: "query is required" }); return; }
    setSseHeaders(res);
    // v5.99: HARD PROVIDER OVERRIDE — self-improvement queries MUST use Claude (openrouter), never DeepSeek.
    // The tier selector (Auto = DeepSeek) fires BEFORE this endpoint and overwrites the provider.
    // This override runs AFTER the tier call and forces openrouter for any self-mod query.
    // DeepSeek V3 hallucinates tool calls and cannot reliably read/write files.
    const SELF_MOD_AGENT_PATTERN = /self.?improv|self.?modif|self.?enhanc|self.?aware|self.?diagnos|self.?patch|self.?fix|self.?read|self.?write|look at your code|examine your code|read your code|your source code|your codebase|your engine|your architect|fix yourself|improve yourself|upgrade your|fully autonomous|SOTA.*yourself|truncat.*fix|fix.*truncat|take a look at your|enhancements.*need|grade.*code/i;
    if (SELF_MOD_AGENT_PATTERN.test(query)) {
      try {
        setActiveProvider({ id: "openrouter" });
        console.log(`[v5.99] Self-improvement query detected \u2014 forcing provider to openrouter (Claude) regardless of tier`);
      } catch { /* non-fatal */ }
    }
    try {
      const workDir = getWorkspaceDir();
      const sid = clientSessionId || `react-${Date.now()}`;
      const engine = streamAgentToSSE(res, query, workDir, { maxSteps: maxSteps ?? 200, sessionId: sid });  // v5.68: Pass session ID for token budget isolation
      // v5.36: Store engine in session map for human-in-the-loop
      activeAgentSessions.set(sid, engine);
      // Send session ID to client so it can respond
      try { if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: "session_id", sessionId: sid })}\n\n`); } catch {}
      // Cleanup when done
      const checkDone = setInterval(() => {
        if (!engine.running) { activeAgentSessions.delete(sid); clearInterval(checkDone); }
      }, 2000);
    } catch (err) {
      sseWrite(res, { type: "error", error: (err as Error).message });
      res.end();
    }
  });

  // v5.36: Real human-in-the-loop response — resolves pending Promise in the engine
  app.post("/api/agent/react/respond", (req, res) => {
    const { sessionId, answer } = req.body;
    if (!sessionId || !answer) { res.status(400).json({ error: "sessionId and answer required" }); return; }
    const engine = activeAgentSessions.get(sessionId);
    if (!engine) { res.status(404).json({ error: "No active agent session found for this sessionId" }); return; }
    if (!engine.hasPendingQuestion()) { res.status(400).json({ error: "Agent has no pending question" }); return; }
    const resolved = engine.provideHumanResponse(answer);
    res.json({ success: resolved, message: resolved ? "Response delivered to agent" : "Failed to deliver response" });
  });

  // v5.36: Check agent session status
  app.get("/api/agent/react/status/:sessionId", (req, res) => {
    const engine = activeAgentSessions.get(req.params.sessionId);
    if (!engine) { res.json({ active: false }); return; }
    res.json({
      active: engine.running,
      step: engine.step,
      state: engine.getState(),
      hasPendingQuestion: engine.hasPendingQuestion(),
      pendingQuestion: engine.getPendingQuestion(),
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // v5.39: Agent Interrupt / Steer / Pause / Resume
  // ═══════════════════════════════════════════════════════════════════════════

  // Interrupt — stop the agent gracefully after current step
  app.post("/api/agent/react/interrupt", (req, res) => {
    const { sessionId, reason } = req.body;
    if (!sessionId) { res.status(400).json({ error: "sessionId required" }); return; }
    const engine = activeAgentSessions.get(sessionId);
    if (!engine) { res.status(404).json({ error: "No active agent session" }); return; }
    const success = engine.interrupt(reason);
    res.json({ success, message: success ? "Agent interrupted" : "Agent not running" });
  });

  // Steer — inject new instructions into the running agent
  app.post("/api/agent/react/steer", (req, res) => {
    const { sessionId, instructions } = req.body;
    if (!sessionId || !instructions) { res.status(400).json({ error: "sessionId and instructions required" }); return; }
    const engine = activeAgentSessions.get(sessionId);
    if (!engine) { res.status(404).json({ error: "No active agent session" }); return; }
    const success = engine.steer(instructions);
    res.json({ success, message: success ? "Agent redirected with new instructions" : "Agent not running" });
  });

  // Pause — pause the agent after current step
  app.post("/api/agent/react/pause", (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) { res.status(400).json({ error: "sessionId required" }); return; }
    const engine = activeAgentSessions.get(sessionId);
    if (!engine) { res.status(404).json({ error: "No active agent session" }); return; }
    const success = engine.pause();
    res.json({ success, message: success ? "Agent paused" : "Agent not running or already paused" });
  });

  // Resume — resume a paused agent
  app.post("/api/agent/react/resume", (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) { res.status(400).json({ error: "sessionId required" }); return; }
    const engine = activeAgentSessions.get(sessionId);
    if (!engine) { res.status(404).json({ error: "No active agent session" }); return; }
    const success = engine.resume();
    res.json({ success, message: success ? "Agent resumed" : "Agent not paused" });
  });
}
