/**
 * apiSchemaInferrer.ts — v51.0.0
 *
 * Infers JSON schemas from sample API responses, building typed
 * interface definitions automatically from observed data.
 */

export interface InferredSchema {
  type: "object" | "array" | "string" | "number" | "boolean" | "null";
  properties?: Record<string, InferredSchema>;
  items?: InferredSchema;
  required?: string[];
  nullable?: boolean;
  examples?: unknown[];
}

export function inferSchema(value: unknown, maxDepth = 5): InferredSchema {
  if (maxDepth <= 0) return { type: "object" };

  if (value === null || value === undefined) {
    return { type: "null", nullable: true };
  }

  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "number") return { type: "number" };
  if (typeof value === "string") return { type: "string" };

  if (Array.isArray(value)) {
    if (value.length === 0) return { type: "array", items: { type: "object" } };
    // Merge schemas from all items
    const itemSchemas = value.map(item => inferSchema(item, maxDepth - 1));
    const merged = mergeSchemas(itemSchemas);
    return { type: "array", items: merged };
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const properties: Record<string, InferredSchema> = {};
    const required: string[] = [];

    for (const [key, val] of Object.entries(obj)) {
      properties[key] = inferSchema(val, maxDepth - 1);
      if (val !== null && val !== undefined) required.push(key);
    }

    return { type: "object", properties, required };
  }

  return { type: "string" };
}

function mergeSchemas(schemas: InferredSchema[]): InferredSchema {
  if (schemas.length === 0) return { type: "object" };
  if (schemas.length === 1) return schemas[0];

  // If all same type, merge properties
  const types = new Set(schemas.map(s => s.type));
  if (types.size === 1 && schemas[0].type === "object") {
    const allKeys = new Set(schemas.flatMap(s => Object.keys(s.properties ?? {})));
    const properties: Record<string, InferredSchema> = {};
    for (const key of allKeys) {
      const keySchemas = schemas.filter(s => s.properties?.[key]).map(s => s.properties![key]);
      properties[key] = keySchemas.length > 0 ? mergeSchemas(keySchemas) : { type: "string" };
    }
    // Required = keys present in ALL schemas
    const required = Array.from(allKeys).filter(k => schemas.every(s => s.required?.includes(k)));
    return { type: "object", properties, required };
  }

  // Mixed types — return most common
  const typeArr = schemas.map(s => s.type);
  const typeCount = typeArr.reduce((acc, t) => { acc[t] = (acc[t] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  const dominantType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0][0] as InferredSchema["type"];
  return { type: dominantType, nullable: typeArr.includes("null") };
}

export function schemaToPseudoTypeScript(name: string, schema: InferredSchema, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (schema.type === "object" && schema.properties) {
    const fields = Object.entries(schema.properties)
      .map(([k, v]) => `${pad}  ${k}${schema.required?.includes(k) ? "" : "?"}: ${schemaToTsType(v)};`)
      .join("\n");
    return `${pad}interface ${name} {\n${fields}\n${pad}}`;
  }
  return `${pad}type ${name} = ${schemaToTsType(schema)};`;
}

function schemaToTsType(schema: InferredSchema): string {
  if (schema.type === "array") return `Array<${schemaToTsType(schema.items ?? { type: "unknown" as InferredSchema["type"] })}>`;
  if (schema.type === "object") return "Record<string, unknown>";
  if (schema.nullable) return `${schema.type} | null`;
  return schema.type;
}
