/**
 * apiDocumentationParser.ts — v51.0.0
 *
 * Parses API documentation from multiple formats (OpenAPI/Swagger JSON,
 * plain text, Markdown) and extracts structured endpoint definitions.
 */

export interface ApiEndpoint {
  path: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  summary: string;
  parameters: ApiParameter[];
  requestBody?: ApiSchema;
  responses: Record<string, ApiSchema>;
  tags: string[];
}

export interface ApiParameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required: boolean;
  type: string;
  description: string;
}

export interface ApiSchema {
  type: string;
  properties?: Record<string, { type: string; description?: string }>;
  description?: string;
}

export interface ParsedApiDoc {
  title: string;
  version: string;
  baseUrl: string;
  endpoints: ApiEndpoint[];
  format: "openapi" | "markdown" | "plain";
}

export function parseOpenApiJson(raw: string): ParsedApiDoc {
  const spec = JSON.parse(raw);
  const endpoints: ApiEndpoint[] = [];

  const paths = spec.paths ?? {};
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(methods as Record<string, unknown>)) {
      const operation = op as Record<string, unknown>;
      const parameters: ApiParameter[] = ((operation.parameters ?? []) as Array<Record<string, unknown>>).map(p => ({
        name: String(p.name ?? ""),
        in: (p.in as ApiParameter["in"]) ?? "query",
        required: Boolean(p.required ?? false),
        type: String((p.schema as Record<string, unknown>)?.type ?? "string"),
        description: String(p.description ?? ""),
      }));

      const responses: Record<string, ApiSchema> = {};
      for (const [code, resp] of Object.entries((operation.responses ?? {}) as Record<string, unknown>)) {
        const r = resp as Record<string, unknown>;
        responses[code] = { type: "object", description: String(r.description ?? "") };
      }

      endpoints.push({
        path,
        method: method.toUpperCase() as ApiEndpoint["method"],
        summary: String(operation.summary ?? ""),
        parameters,
        responses,
        tags: (operation.tags as string[]) ?? [],
      });
    }
  }

  const servers = (spec.servers as Array<Record<string, string>>) ?? [];
  const baseUrl = servers[0]?.url ?? "";

  return {
    title: spec.info?.title ?? "Unknown API",
    version: spec.info?.version ?? "1.0.0",
    baseUrl,
    endpoints,
    format: "openapi",
  };
}

export function parseMarkdownDoc(markdown: string): ParsedApiDoc {
  const endpoints: ApiEndpoint[] = [];
  const lines = markdown.split("\n");
  let title = "Unknown API";
  let version = "1.0.0";
  let baseUrl = "";

  for (const line of lines) {
    if (line.startsWith("# ")) title = line.slice(2).trim();
    if (line.toLowerCase().includes("version:")) version = line.split(":")[1]?.trim() ?? version;
    if (line.toLowerCase().includes("base url:") || line.toLowerCase().includes("baseurl:")) {
      baseUrl = line.split(":").slice(1).join(":").trim();
    }

    // Detect endpoint lines like: `GET /api/users`
    const endpointMatch = line.match(/`?(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s`]*)`?/i);
    if (endpointMatch) {
      endpoints.push({
        path: endpointMatch[2],
        method: endpointMatch[1].toUpperCase() as ApiEndpoint["method"],
        summary: "",
        parameters: [],
        responses: { "200": { type: "object", description: "Success" } },
        tags: [],
      });
    }
  }

  return { title, version, baseUrl, endpoints, format: "markdown" };
}

export function getEndpointsByTag(doc: ParsedApiDoc, tag: string): ApiEndpoint[] {
  return doc.endpoints.filter(e => e.tags.includes(tag));
}

export function getEndpointsByMethod(doc: ParsedApiDoc, method: ApiEndpoint["method"]): ApiEndpoint[] {
  return doc.endpoints.filter(e => e.method === method);
}
