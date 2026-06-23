# Andromeda REST API Reference

**Version:** 9.12.0  
**Base URL:** `http://localhost:3000`  
**Authentication:** Admin endpoints require `Authorization: Bearer <ADMIN_TOKEN>` header.

---

## RSI (Recursive Self-Improvement)

The RSI API controls Andromeda's autonomous self-improvement engine.

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/rsi/status` | — | Current RSI engine phase, cycle count, last/next cycle timestamps |
| `POST` | `/api/rsi/trigger` | Admin | Immediately trigger an RSI improvement cycle |
| `POST` | `/api/rsi/enable` | Admin | Enable the RSI engine |
| `POST` | `/api/rsi/disable` | Admin | Disable the RSI engine |
| `POST` | `/api/rsi/confirm` | Admin | Confirm a pending RSI action |
| `GET` | `/api/rsi/history` | — | Full cycle history with proposals generated/applied per cycle |
| `GET` | `/api/rsi/health` | — | RSI subsystem health: proposal counts by status, eval scores |
| `GET` | `/api/rsi/proof` | — | Proof-of-improvement: eval score deltas per applied proposal |
| `GET` | `/api/rsi/proof-history` | — | Historical proof records |
| `GET` | `/api/rsi/discoveries` | — | Capability discoveries from RSI cycles |
| `GET` | `/api/rsi/scheduler` | — | Scheduler status: interval, next run, pause state |
| `POST` | `/api/rsi/scheduler/trigger` | Admin | Trigger scheduler cycle immediately |
| `POST` | `/api/rsi/scheduler/pause` | Admin | Pause the scheduler |
| `POST` | `/api/rsi/scheduler/resume` | Admin | Resume the scheduler |
| `POST` | `/api/rsi/scheduler/set-hours` | Admin | Set scheduler interval in hours |
| `GET` | `/api/rsi/db/status` | — | RSI database/persistence layer status |

### RSI Status Response

```json
{
  "phase": "idle",
  "enabled": true,
  "cycleCount": 12,
  "lastCycleAt": 1749420000000,
  "nextCycleAt": 1749421800000
}
```

---

## Proposals

Proposals are RSI-generated code improvements awaiting human review or auto-apply.

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/self/proposals` | — | List proposals. Query: `?status=pending\|applied\|rejected\|all` |
| `POST` | `/api/self/proposals/:id/approve` | Admin | Approve and apply a proposal |
| `POST` | `/api/self/proposals/:id/reject` | Admin | Reject a proposal |
| `DELETE` | `/api/self/proposals/:id` | Admin | Delete a proposal |
| `GET` | `/api/self/proposals/:id/diff` | — | Get the unified diff for a proposal |
| `POST` | `/api/self/analyze` | Admin | Trigger analysis of a specific file |
| `GET` | `/api/self/config` | — | Auto-apply configuration (confidence threshold, max per hour) |
| `POST` | `/api/self/config` | Admin | Update auto-apply configuration |
| `GET` | `/api/self/status` | — | Full self-improvement subsystem status |

### Proposal Object

```json
{
  "id": "prop_abc123",
  "targetFile": "server/adaptiveRouter.ts",
  "title": "Extract route config into named constants",
  "rationale": "Magic strings reduce maintainability",
  "category": "readability",
  "impact": "medium",
  "confidence": 0.87,
  "diff": "--- a/server/adaptiveRouter.ts\n+++ b/server/adaptiveRouter.ts\n...",
  "status": "pending",
  "createdAt": 1749420000000
}
```

---

## Evaluation

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/eval/tasks` | — | All 60 evaluation tasks |
| `GET` | `/api/eval/baseline` | — | Current baseline scores per task |
| `GET` | `/api/eval/history` | — | Historical eval run results |
| `GET` | `/api/eval/trend` | — | Score trend over time (for charts) |
| `GET` | `/api/eval/stream` | — | SSE stream of live eval progress |

---

## Memory

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/memory` | — | List all memories. Query: `?type=fact\|event\|skill\|preference` |
| `POST` | `/api/memory` | — | Store a new memory entry |
| `DELETE` | `/api/memory/:id` | Admin | Delete a specific memory |
| `GET` | `/api/memory/vector-stats` | — | Vector index stats: entry count, dimensions, model, neural vs TF-IDF |
| `GET` | `/api/memory/consolidation/config` | — | Memory consolidation settings |
| `GET` | `/api/memory/consolidation/scored` | — | Memories scored for consolidation |
| `GET` | `/api/episodic/stats` | — | Episodic memory statistics |
| `DELETE` | `/api/vector/:id` | Admin | Delete a vector embedding |

### Vector Stats Response

```json
{
  "vector": {
    "entryCount": 142,
    "dimension": 1536,
    "model": "text-embedding-3-small",
    "sizeBytes": 876544
  },
  "memory": {
    "total": 89,
    "byType": { "fact": 34, "event": 28, "skill": 15, "preference": 12 }
  },
  "neuralActive": true
}
```

---

## LLM & Model Routing

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/llm/providers` | — | All configured LLM providers and their status |
| `GET` | `/api/llm/tiers` | — | Model tier definitions (fast/standard/pro) |
| `GET` | `/api/llm/routing-config` | — | Current adaptive routing configuration |
| `POST` | `/api/llm/routing-config` | Admin | Update routing rules |

---

## Goals & Planning

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/goals` | — | All goals |
| `POST` | `/api/goals` | — | Create a new goal |
| `GET` | `/api/goals/:id` | — | Get a specific goal |
| `DELETE` | `/api/goals/:id` | Admin | Delete a goal |
| `GET` | `/api/goals/:id/events` | — | Goal event history |
| `GET` | `/api/goals/:id/checkpoints` | — | Goal checkpoints |
| `GET` | `/api/goals/:id/next` | — | Next recommended action for goal |
| `GET` | `/api/goals/:id/parallel` | — | Parallel execution plan |
| `GET` | `/api/goals/:id/evaluate` | — | Evaluate goal completion |
| `GET` | `/api/goals/active/summary` | — | Summary of all active goals |
| `GET` | `/api/goals/stats` | — | Goal statistics |
| `GET` | `/api/goals/optimal-order` | — | Optimal goal execution order |
| `GET` | `/api/goals/reprioritization/history` | — | Reprioritization history |
| `GET` | `/api/goals/reprioritization/rules` | — | Active reprioritization rules |
| `GET` | `/api/goals/reprioritization/stats` | — | Reprioritization statistics |

---

## Code Intelligence

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/deps/tree/:file` | — | Dependency tree for a file |
| `GET` | `/api/deps/impact/:file` | — | Files impacted by changes to a file |
| `GET` | `/api/deps/circular` | — | Circular dependency detection |
| `GET` | `/api/deps/importance` | — | Module importance ranking |
| `GET` | `/api/deps/stats` | — | Dependency graph statistics |
| `GET` | `/api/deps/history` | — | Dependency change history |
| `GET` | `/api/deps/config` | — | Dependency analysis configuration |
| `GET` | `/api/deps/package-json` | — | package.json dependency analysis |

---

## System & Health

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | — | Server health check |
| `GET` | `/api/diagnostics` | — | Full system diagnostics |
| `GET` | `/api/manifest` | — | Andromeda capability manifest |
| `GET` | `/api/manifest/prompt` | — | System prompt manifest |
| `GET` | `/api/config` | — | Current server configuration |
| `GET` | `/api/introspect` | — | Full system introspection |
| `GET` | `/api/introspect/quick` | — | Quick introspection summary |
| `GET` | `/api/infra/status` | — | Infrastructure status |
| `GET` | `/api/hot-reload/status` | — | Hot-reload watcher status |
| `GET` | `/api/ci/status` | — | CI pipeline status |
| `GET` | `/api/ci/history` | — | CI run history |
| `GET` | `/api/guard/config` | — | Safety guard configuration |
| `GET` | `/api/guard/audit` | — | Safety guard audit log |
| `GET` | `/api/guard/backups` | — | File backup list (for rollbacks) |

---

## Git

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/git/log` | — | Git commit log. Query: `?limit=30` |

### Git Log Response

```json
{
  "commits": [
    {
      "hash": "f192c80",
      "subject": "v9.12.0: RSI integration tests, coverage, route split",
      "author": "Andromeda",
      "date": "2026-06-08T16:00:00Z"
    }
  ]
}
```

---

## MCP (Model Context Protocol)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/mcp/servers` | — | Registered MCP servers |
| `POST` | `/api/mcp/servers` | Admin | Register a new MCP server |
| `DELETE` | `/api/mcp/servers/:id` | Admin | Remove an MCP server |

---

## Workspace & Files

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/workspace/file` | — | Read a workspace file |
| `DELETE` | `/api/workspace/file` | Admin | Delete a workspace file |

---

## Streaming Chat

The primary chat endpoint streams responses via Server-Sent Events (SSE).

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chat/stream` | Stream a chat response (SSE) |
| `POST` | `/api/search/stream` | Stream a web search + synthesis (SSE) |
| `POST` | `/api/edit/stream` | Stream a file edit operation (SSE) |
| `POST` | `/api/code/stream` | Stream a code generation response (SSE) |

### SSE Event Types

```
data: {"type":"token","content":"Hello"}
data: {"type":"tool_call","name":"web_search","args":{}}
data: {"type":"tool_result","name":"web_search","result":{}}
data: {"type":"done","sessionId":"sess_abc123"}
data: {"type":"error","message":"Rate limit exceeded"}
```

---

## Degradation Monitoring

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/degradation/status` | Current degradation detection status |
| `GET` | `/api/degradation/history` | Historical degradation events |

---

## Federated Learning

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/federated/nodes` | Registered federated nodes |
| `POST` | `/api/federated/nodes` | Register a new node |
| `POST` | `/api/federated/sync` | Trigger federated sync |

---

## Error Responses

All endpoints return standard error objects on failure:

```json
{
  "error": "Proposal not found",
  "code": "NOT_FOUND",
  "statusCode": 404
}
```

| Status | Meaning |
|---|---|
| 200 | Success |
| 400 | Bad request (validation error) |
| 401 | Unauthorized (missing/invalid admin token) |
| 404 | Resource not found |
| 429 | Rate limited |
| 500 | Internal server error |
