const fs = require('fs');
let content = fs.readFileSync('server/routes/autonomyRoutes.ts', 'utf8');

const imports = `import { validateBody } from "./validate.js";
import { 
  goalCreateSchema, subGoalCreateSchema, checkpointCreateSchema, metaGoalCreateSchema,
  scheduledTaskCreateSchema, busPublishSchema, busSubscribeSchema, busQuerySchema,
  apiKeyCreateSchema, testGenerateSchema
} from "./zodSchemas.js";\n`;

content = imports + content;

content = content.replace(/app\.post\("\/api\/goals", \(req, res\) => \{/, 'app.post("/api/goals", validateBody(goalCreateSchema), (req, res) => {');
content = content.replace(/app\.post\("\/api\/goals\/:id\/subgoals", \(req, res\) => \{/, 'app.post("/api/goals/:id/subgoals", validateBody(subGoalCreateSchema), (req, res) => {');
content = content.replace(/app\.post\("\/api\/goals\/:id\/checkpoint", \(req, res\) => \{/, 'app.post("/api/goals/:id/checkpoint", validateBody(checkpointCreateSchema), (req, res) => {');

content = content.replace(/app\.post\("\/api\/meta-goals", async \(req, res\) => \{/, 'app.post("/api/meta-goals", validateBody(metaGoalCreateSchema), async (req, res) => {');

content = content.replace(/app\.post\("\/api\/scheduler\/tasks", \(req, res\) => \{/, 'app.post("/api/scheduler/tasks", validateBody(scheduledTaskCreateSchema), (req, res) => {');

content = content.replace(/app\.post\("\/api\/bus\/publish", \(req, res\) => \{/, 'app.post("/api/bus/publish", validateBody(busPublishSchema), (req, res) => {');
content = content.replace(/app\.post\("\/api\/bus\/subscribe", \(req, res\) => \{/, 'app.post("/api/bus/subscribe", validateBody(busSubscribeSchema), (req, res) => {');
content = content.replace(/app\.post\("\/api\/bus\/query", \(req, res\) => \{/, 'app.post("/api/bus/query", validateBody(busQuerySchema), (req, res) => {');

content = content.replace(/app\.post\("\/api\/security\/keys", \(req, res\) => \{/, 'app.post("/api/security/keys", validateBody(apiKeyCreateSchema), (req, res) => {');

content = content.replace(/app\.post\("\/api\/tests\/generate", async \(req, res\) => \{/, 'app.post("/api/tests/generate", validateBody(testGenerateSchema), async (req, res) => {');
content = content.replace(/app\.post\("\/api\/tests\/generate-and-run", async \(req, res\) => \{/, 'app.post("/api/tests/generate-and-run", validateBody(testGenerateSchema), async (req, res) => {');

fs.writeFileSync('server/routes/autonomyRoutes.ts', content);
console.log('autonomyRoutes patched');
