const fs = require('fs');
let content = fs.readFileSync('server/routes/systemRoutes.ts', 'utf8');

const imports = `import { validateBody } from "./validate.js";
import { 
  rollbackCreateSchema, selfModifySchema, selfModifyBatchSchema 
} from "./zodSchemas.js";\n`;

content = imports + content;

content = content.replace(/app\.post\("\/api\/rollback\/create", async \(req, res\) => \{/, 'app.post("/api/rollback/create", validateBody(rollbackCreateSchema), async (req, res) => {');
content = content.replace(/app\.post\("\/api\/self-modify", async \(req, res\) => \{/, 'app.post("/api/self-modify", validateBody(selfModifySchema), async (req, res) => {');
content = content.replace(/app\.post\("\/api\/self-modify\/batch", async \(req, res\) => \{/, 'app.post("/api/self-modify/batch", validateBody(selfModifyBatchSchema), async (req, res) => {');

fs.writeFileSync('server/routes/systemRoutes.ts', content);
console.log('systemRoutes patched');
