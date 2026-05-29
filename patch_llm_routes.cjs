const fs = require('fs');
let content = fs.readFileSync('server/routes/llmRoutes.ts', 'utf8');

const imports = `import { validateBody } from "./validate.js";
import { 
  planGenerateSchema, vectorStoreSchema, vectorStoreBatchSchema, 
  vectorSearchSchema, vectorConfigSchema, knowledgeDecisionSchema, 
  knowledgeIssueSchema, knowledgeLearningSchema 
} from "./zodSchemas.js";\n`;

content = imports + content;

content = content.replace(/app\.post\("\/api\/vector\/store", async \(req, res\) => \{/, 'app.post("/api/vector/store", validateBody(vectorStoreSchema), async (req, res) => {');
content = content.replace(/app\.post\("\/api\/vector\/store-batch", async \(req, res\) => \{/, 'app.post("/api/vector/store-batch", validateBody(vectorStoreBatchSchema), async (req, res) => {');
content = content.replace(/app\.post\("\/api\/vector\/search", async \(req, res\) => \{/, 'app.post("/api/vector/search", validateBody(vectorSearchSchema), async (req, res) => {');
content = content.replace(/app\.post\("\/api\/vector\/hybrid-search", async \(req, res\) => \{/, 'app.post("/api/vector/hybrid-search", validateBody(vectorSearchSchema), async (req, res) => {');
content = content.replace(/app\.post\("\/api\/vector\/config", \(req, res\) => \{/, 'app.post("/api/vector/config", validateBody(vectorConfigSchema), (req, res) => {');

content = content.replace(/app\.post\("\/api\/knowledge\/decisions", async \(req, res\) => \{/, 'app.post("/api/knowledge/decisions", validateBody(knowledgeDecisionSchema), async (req, res) => {');
content = content.replace(/app\.post\("\/api\/knowledge\/issues", async \(req, res\) => \{/, 'app.post("/api/knowledge/issues", validateBody(knowledgeIssueSchema), async (req, res) => {');
content = content.replace(/app\.post\("\/api\/knowledge\/learnings", async \(req, res\) => \{/, 'app.post("/api/knowledge/learnings", validateBody(knowledgeLearningSchema), async (req, res) => {');

content = content.replace(/app\.post\("\/api\/plan\/generate", heavyLimiter, async \(req, res\) => \{/, 'app.post("/api/plan/generate", heavyLimiter, validateBody(planGenerateSchema), async (req, res) => {');

fs.writeFileSync('server/routes/llmRoutes.ts', content);
console.log('llmRoutes patched');
