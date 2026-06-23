const fs = require('fs');
let content = fs.readFileSync('server/_core/initRoutes.ts', 'utf8');

const imports = `import { validateBody } from "../routes/validate.js";
import { 
  rsiEnableSchema, episodicRecordSchema, planDecomposeSchema 
} from "../routes/zodSchemas.js";\n`;

content = imports + content;

content = content.replace(/app\.post\("\/api\/rsi\/enable", requireAdminAuth, async \(req, res\) => \{/, 'app.post("/api/rsi/enable", requireAdminAuth, validateBody(rsiEnableSchema), async (req, res) => {');
content = content.replace(/app\.post\("\/api\/episodic\/record", async \(req, res\) => \{/, 'app.post("/api/episodic/record", validateBody(episodicRecordSchema), async (req, res) => {');
content = content.replace(/app\.post\("\/api\/plan\/decompose", async \(req, res\) => \{/, 'app.post("/api/plan/decompose", validateBody(planDecomposeSchema), async (req, res) => {');

fs.writeFileSync('server/_core/initRoutes.ts', content);
console.log('initRoutes patched');
