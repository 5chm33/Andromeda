/**
 * ontologyManager.ts — v85.0.0 "Knowledge Graph & Reasoning"
 * Manages class hierarchies, property definitions, and ontology validation.
 */
export interface OntologyClass {
  classId: string;
  name: string;
  parentClassId: string | null;
  properties: string[];
  description: string;
}

export interface OntologyProperty {
  propertyId: string;
  name: string;
  domain: string;
  range: string;
  isRequired: boolean;
  isMultiValued: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const classes = new Map<string, OntologyClass>();
const properties = new Map<string, OntologyProperty>();
let classCounter = 0;
let propCounter = 0;

export function defineClass(name: string, parentClassId: string | null, propertyNames: string[], description = ""): OntologyClass {
  const cls: OntologyClass = { classId: `cls-${++classCounter}`, name, parentClassId, properties: propertyNames, description };
  classes.set(cls.classId, cls);
  return cls;
}

export function defineProperty(name: string, domain: string, range: string, isRequired = false, isMultiValued = false): OntologyProperty {
  const prop: OntologyProperty = { propertyId: `prop-${++propCounter}`, name, domain, range, isRequired, isMultiValued };
  properties.set(prop.propertyId, prop);
  return prop;
}

export function getAncestors(classId: string): OntologyClass[] {
  const ancestors: OntologyClass[] = [];
  let current = classes.get(classId);
  while (current?.parentClassId) {
    const parent = classes.get(current.parentClassId);
    if (!parent) break;
    ancestors.push(parent);
    current = parent;
  }
  return ancestors;
}

export function isSubclassOf(classId: string, targetClassId: string): boolean {
  const ancestors = getAncestors(classId);
  return ancestors.some(a => a.classId === targetClassId);
}

export function validateInstance(classId: string, instanceProperties: Record<string, unknown>): ValidationResult {
  const cls = classes.get(classId);
  if (!cls) return { valid: false, errors: [`Unknown class: ${classId}`], warnings: [] };

  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required properties
  for (const propName of cls.properties) {
    const prop = [...properties.values()].find(p => p.name === propName && p.domain === cls.name);
    if (prop?.isRequired && !(propName in instanceProperties)) {
      errors.push(`Required property "${propName}" is missing`);
    }
  }

  // Check for unknown properties
  for (const key of Object.keys(instanceProperties)) {
    if (!cls.properties.includes(key)) {
      warnings.push(`Unknown property "${key}" for class "${cls.name}"`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function getClass(classId: string): OntologyClass | undefined { return classes.get(classId); }
export function getAllClasses(): OntologyClass[] { return [...classes.values()]; }
export function _resetOntologyManagerForTest(): void { classes.clear(); properties.clear(); classCounter = 0; propCounter = 0; }
