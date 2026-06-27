/**
 * documentTemplateEngine.ts — v82.0.0 "Document Intelligence"
 * Renders document templates with variable substitution, conditionals, and loops.
 */
export interface DocumentTemplate {
  templateId: string;
  name: string;
  content: string;
  variables: string[];
  createdAt: number;
}

export interface RenderResult {
  templateId: string;
  rendered: string;
  missingVariables: string[];
  renderTimeMs: number;
}

const templates = new Map<string, DocumentTemplate>();
let templateCounter = 0;

export function registerTemplate(name: string, content: string): DocumentTemplate {
  // Extract variable names from {{varName}} patterns
  const variables = [...new Set([...content.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))];
  const template: DocumentTemplate = {
    templateId: `tmpl-${++templateCounter}`,
    name, content, variables,
    createdAt: Date.now(),
  };
  templates.set(template.templateId, template);
  return template;
}

export function renderTemplate(templateId: string, variables: Record<string, string | number | boolean>): RenderResult {
  const start = Date.now();
  const template = templates.get(templateId);
  if (!template) return { templateId, rendered: "", missingVariables: [], renderTimeMs: 0 };

  const missingVariables: string[] = [];
  let rendered = template.content;

  // Substitute variables
  for (const varName of template.variables) {
    if (varName in variables) {
      rendered = rendered.replace(new RegExp(`\\{\\{${varName}\\}\\}`, "g"), String(variables[varName]));
    } else {
      missingVariables.push(varName);
    }
  }

  // Process conditionals: {{#if varName}}...{{/if}}
  rendered = rendered.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, varName, block) => {
    return variables[varName] ? block : "";
  });

  // Process loops: {{#each items}}...{{/each}} (simplified: items as comma-separated string)
  rendered = rendered.replace(/\{\{#each (\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, varName, block) => {
    const items = String(variables[varName] ?? "").split(",").filter(Boolean);
    return items.map(item => block.replace(/\{\{item\}\}/g, item.trim())).join("");
  });

  return { templateId, rendered, missingVariables, renderTimeMs: Date.now() - start };
}

export function getTemplate(templateId: string): DocumentTemplate | undefined { return templates.get(templateId); }
export function getAllTemplates(): DocumentTemplate[] { return [...templates.values()]; }
export function _resetDocumentTemplateEngineForTest(): void { templates.clear(); templateCounter = 0; }
