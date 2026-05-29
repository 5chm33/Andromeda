import { z } from "zod";

// --- autonomyRoutes schemas ---
export const goalCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  successCriteria: z.array(z.string()).optional()
});

export const subGoalCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  dependencies: z.array(z.string()).optional(),
  requiresApproval: z.boolean().optional(),
  estimatedComplexity: z.enum(["simple", "moderate", "complex"]).optional()
});

export const checkpointCreateSchema = z.object({
  message: z.string().min(1),
  options: z.array(z.string()).optional()
});

export const metaGoalCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  successCriteria: z.array(z.string()).optional()
});

export const scheduledTaskCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  cron: z.string().optional(),
  executeAt: z.string().optional(),
  intervalSeconds: z.number().optional(),
  action: z.string().min(1),
  actionType: z.enum(["react", "webhook", "script"]),
  webhookUrl: z.string().optional(),
  webhookMethod: z.enum(["GET", "POST", "PUT", "DELETE"]).optional(),
  webhookBody: z.string().optional(),
  recurring: z.boolean().optional(),
  maxRuns: z.number().optional(),
  storeInMemory: z.boolean().optional(),
  tags: z.array(z.string()).optional()
});

export const busPublishSchema = z.object({
  channel: z.string().min(1),
  agentId: z.string().min(1),
  agentRole: z.string().min(1),
  type: z.enum(["finding", "progress", "artifact", "question", "answer", "handoff", "warning", "decision", "dependency"]),
  title: z.string().min(1),
  content: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
  replyTo: z.string().optional(),
  tags: z.array(z.string()).optional()
});

export const busSubscribeSchema = z.object({
  agentId: z.string().min(1),
  channel: z.string().min(1),
  filter: z.object({
    types: z.array(z.enum(["finding", "progress", "artifact", "question", "answer", "handoff", "warning", "decision", "dependency"])).optional(),
    fromAgents: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional()
  }).optional()
});

export const busQuerySchema = z.object({
  channels: z.array(z.string()).optional(),
  types: z.array(z.enum(["finding", "progress", "artifact", "question", "answer", "handoff", "warning", "decision", "dependency"])).optional(),
  fromAgents: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  since: z.number().optional(),
  limit: z.number().optional(),
  unreadOnly: z.boolean().optional(),
  forAgent: z.string().optional()
});

export const apiKeyCreateSchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.enum(["search", "chat", "agent", "memory", "code", "self-improve", "scheduler", "admin", "*"])),
  rateLimit: z.number().optional(),
  expiresAt: z.string().optional(),
  metadata: z.record(z.string()).optional()
});

export const testGenerateSchema = z.object({
  code: z.string().min(1),
  filePath: z.string().min(1),
  language: z.enum(["typescript", "python", "bash"]).optional()
});

// --- llmRoutes schemas ---
export const planGenerateSchema = z.object({
  goal: z.string().min(1),
  model: z.string().optional()
});

export const vectorStoreSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1)
});

export const vectorStoreBatchSchema = z.object({
  entries: z.array(z.object({
    id: z.string().min(1),
    text: z.string().min(1)
  })).min(1)
});

export const vectorSearchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().optional(),
  minScore: z.number().optional()
});

export const vectorConfigSchema = z.object({
  provider: z.enum(["api", "local-hash"]),
  apiUrl: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional()
});

export const knowledgeDecisionSchema = z.object({
  title: z.string().min(1),
  context: z.string().min(1),
  decision: z.string().min(1),
  rationale: z.string().min(1),
  alternatives: z.array(z.string()).optional(),
  consequences: z.array(z.string()).optional(),
  relatedFiles: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional()
});

export const knowledgeIssueSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(["critical", "high", "medium", "low"]),
  affectedModules: z.array(z.string()),
  workaround: z.string().optional()
});

export const knowledgeLearningSchema = z.object({
  category: z.enum(["success", "failure", "insight", "pattern", "antipattern"]),
  title: z.string().min(1),
  description: z.string().min(1),
  context: z.string().min(1),
  outcome: z.string().min(1),
  lesson: z.string().min(1),
  applicableTo: z.array(z.string()).optional(),
  confidence: z.number().optional(),
  relatedProposalIds: z.array(z.string()).optional()
});

// --- agentRoutes schemas ---
export const agentStreamSchema = z.object({
  query: z.string().min(1),
  maxSteps: z.number().optional(),
  sessionId: z.string().optional()
});

export const agentRespondSchema = z.object({
  sessionId: z.string().min(1),
  answer: z.string().min(1)
});

// --- selfRoutes schemas ---
export const selfAnalyzeSchema = z.object({
  file: z.string().min(1),
  area: z.string().optional()
});

export const selfApplySchema = z.object({
  proposalId: z.string().min(1)
});

// --- evalRoutes schemas ---
export const evalRunSchema = z.object({
  taskIds: z.array(z.string()).optional(),
  quick: z.boolean().optional()
});

// --- systemRoutes schemas ---
export const rollbackCreateSchema = z.object({
  files: z.array(z.string()).optional(),
  label: z.string().optional()
});

export const selfModifySchema = z.object({
  filePath: z.string().min(1),
  newContent: z.string().min(1),
  reason: z.string().min(1),
  requireTypeCheck: z.boolean().optional(),
  requireTests: z.boolean().optional(),
  hotReload: z.boolean().optional(),
  requireApproval: z.boolean().optional(),
  impact: z.enum(["high", "medium", "low"]).optional(),
  category: z.enum(["security", "performance", "reliability", "readability", "feature"]).optional()
});

export const selfModifyBatchSchema = z.object({
  requests: z.array(selfModifySchema)
});

// --- initRoutes (RSI / Episodic) schemas ---
export const rsiEnableSchema = z.object({
  intervalMs: z.number().optional(),
  maxAutoApplyPerCycle: z.number().optional(),
  requireHumanConfirmAfter: z.number().optional(),
  targetFiles: z.array(z.string()).optional(),
  minConfidenceThreshold: z.number().optional(),
  verboseLogging: z.boolean().optional()
});

export const episodicRecordSchema = z.object({
  goal: z.string().min(1),
  outcome: z.enum(["success", "partial_failure", "failure", "abandoned"]),
  summary: z.string().min(1),
  failedStep: z.string().optional(),
  errorContext: z.string().optional(),
  parentEpisodeId: z.string().optional(),
  duration: z.number().optional()
});

export const planDecomposeSchema = z.object({
  goal: z.string().min(1),
  context: z.string().optional(),
  maxSteps: z.number().optional()
});
