/**
 * packages/app-ui/index.ts — App & UI Package Boundary
 * Andromeda v5.0 (Elicit recommendation #6)
 *
 * Public API for the app-ui package.
 * Contains: HTTP routes, WebSocket handlers, admin auth,
 *           eval routes, dashboard endpoints.
 *
 * This package is the external-facing layer. It should:
 *   - Accept requests from the UI and external callers
 *   - Delegate all agent operations to agent-core
 *   - Delegate all tool execution to tools-sandbox
 *   - Delegate all policy checks to policy-promotion
 *   - Never import directly from internal implementation files
 *
 * DELETION BUDGET (Elicit #6):
 *   For every new route or UI feature added, evaluate whether an
 *   existing route can be consolidated or removed. The goal is to
 *   keep the external surface area minimal and auditable.
 */

// Admin authentication — timing-safe key comparison
export { requireAdminAuth, getAdminKeyForTest } from "../../adminAuth.js";

// Route registrations are handled by _core/index.ts.
// This file documents the package boundary and design contract only.

/**
 * Package dependency rules (enforced by code review, not by tooling yet):
 *
 *   app-ui           → agent-core, tools-sandbox, policy-promotion, evaluation
 *   policy-promotion → agent-core (types only)
 *   evaluation       → tools-sandbox (for Docker execution)
 *   tools-sandbox    → (no internal deps — only Node.js stdlib and npm packages)
 *   agent-core       → tools-sandbox (via agentToolInterface), policy-promotion (for constraints)
 *
 * Circular dependencies are forbidden. If a circular dep is introduced,
 * it indicates a package boundary violation that must be resolved by
 * extracting a shared-types package.
 */
