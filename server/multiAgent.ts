/**
 * multiAgent.ts — v5.1
 *
 * Multi-Agent System: A team of specialized AI agents that collaborate to
 * complete complex coding tasks. Each agent has a distinct role, persona,
 * and set of responsibilities. Agents communicate via a shared context object
 * that accumulates their outputs, so each agent builds on the previous one's work.
 *
 * Agent Roles:
 * ┌─────────────────┬──────────────────────────────────────────────────────────┐
 * │ Architect        │ Breaks down the task, designs the solution architecture, │
 * │                  │ defines file structure, tech stack, and API contracts.   │
 * ├─────────────────┼──────────────────────────────────────────────────────────┤
 * │ Coder            │ Implements the architecture. Writes complete, working    │
 * │                  │ code for each file defined by the Architect.             │
 * ├─────────────────┼──────────────────────────────────────────────────────────┤
 * │ Debugger         │ Reviews the Coder's output for bugs, logic errors,       │
 * │                  │ edge cases, and missing error handling. Produces fixes.  │
 * ├─────────────────┼──────────────────────────────────────────────────────────┤
 * │ Security Auditor │ Scans for security vulnerabilities: injection, auth      │
 * │                  │ issues, exposed secrets, OWASP Top 10, etc.              │
 * └─────────────────┴──────────────────────────────────────────────────────────┘
 *
 * Usage: POST /api/agent/team { task: string }
 * Returns: SSE stream of agent events
 */

import { Response } from "express";

export type AgentRole = "architect" | "coder" | "debugger" | "security";

export type AgentMessage = {
  role: AgentRole;
  name: string;
  emoji: string;
  status: "thinking" | "working" | "done" | "error";
  output?: string;
  artifacts?: CodeArtifact[];
  issues?: Issue[];
  timestamp: number;
};

export type CodeArtifact = {
  filename: string;
  language: string;
  content: string;
  description: string;
};

export type Issue = {
  severity: "critical" | "high" | "medium" | "low" | "info";
  type: "bug" | "security" | "performance" | "style";
  location: string;
  description: string;
  fix?: string;
};

export type TeamContext = {
  task: string;
  architecture?: string;
  artifacts?: CodeArtifact[];
  debugReport?: string;
  securityReport?: string;
  issues?: Issue[];
};

// ─── Agent System Prompts ─────────────────────────────────────────────────────

const AGENT_PROMPTS: Record<AgentRole, string> = {
  architect: `You are the Architect agent on a multi-agent software development team.
Your job is to analyze the user's task and produce a comprehensive technical architecture plan.

Your output MUST include:
1. **Task Analysis**: What exactly needs to be built and why
2. **Technology Stack**: Specific technologies, frameworks, and libraries to use
3. **File Structure**: Complete list of files to create with their purpose
4. **API/Interface Contracts**: Function signatures, data types, API endpoints
5. **Implementation Order**: Which files to build first and why
6. **Key Design Decisions**: Architectural choices and their rationale

Be specific and actionable. The Coder agent will implement exactly what you specify.
Format your output in clear Markdown with code blocks for file structures and type definitions.`,

  coder: `You are the Coder agent on a multi-agent software development team.
The Architect has designed the solution. Your job is to implement it completely.

Rules:
- Write COMPLETE, working code — no placeholders, no "// TODO", no truncation
- Follow the architecture EXACTLY as specified
- Include proper error handling, input validation, and TypeScript types
- Add clear comments explaining non-obvious logic
- Each file should be production-ready

For each file, output it in this exact format:
\`\`\`typescript:filename.ts
[complete file content]
\`\`\`

Or for other languages:
\`\`\`python:filename.py
[complete file content]
\`\`\`

Implement ALL files specified in the architecture. Do not skip any.`,

  debugger: `You are the Debugger agent on a multi-agent software development team.
The Coder has implemented the solution. Your job is to find and fix all bugs.

Review the code for:
1. **Logic Errors**: Incorrect algorithms, wrong conditions, off-by-one errors
2. **Runtime Errors**: Null/undefined access, type mismatches, unhandled exceptions
3. **Edge Cases**: Empty inputs, boundary values, concurrent access
4. **Missing Error Handling**: Unhandled promise rejections, missing try/catch
5. **Performance Issues**: Inefficient algorithms, memory leaks, N+1 queries
6. **Integration Issues**: Mismatched interfaces between files

For each issue found, output:
- **Location**: filename:lineNumber or function name
- **Severity**: critical/high/medium/low
- **Description**: What the bug is and why it's a problem
- **Fix**: The corrected code

Also provide a FIXED VERSION of any files with critical/high severity issues.`,

  security: `You are the Security Auditor agent on a multi-agent software development team.
Your job is to perform a thorough security review of the implemented code.

Check for ALL of the following:
1. **Injection Attacks**: SQL injection, command injection, XSS, SSTI
2. **Authentication/Authorization**: Missing auth checks, privilege escalation, insecure tokens
3. **Sensitive Data Exposure**: Hardcoded secrets, API keys, passwords in code or logs
4. **Input Validation**: Missing sanitization, type checking, size limits
5. **Path Traversal**: Directory traversal in file operations
6. **OWASP Top 10**: All standard web application vulnerabilities
7. **Dependency Issues**: Known vulnerable packages
8. **Cryptography**: Weak algorithms, improper key management
9. **Rate Limiting**: Missing rate limits on sensitive endpoints
10. **Error Information Leakage**: Stack traces or internal details in error responses

For each vulnerability:
- **CVE/CWE**: Reference if applicable
- **Severity**: critical/high/medium/low
- **Location**: Exact file and line
- **Attack Vector**: How an attacker could exploit this
- **Remediation**: Specific code fix

Conclude with an overall security score (0-100) and a prioritized remediation roadmap.`,
};

// ─── Agent Runner ─────────────────────────────────────────────────────────────

async function runAgent(
  role: AgentRole,
  context: TeamContext,
  _apiKey: string  // v5.93: kept for signature compatibility but no longer used directly
): Promise<{ output: string; artifacts?: CodeArtifact[]; issues?: Issue[] }> {
  const _agentNames: Record<AgentRole, string> = {
    architect: "Architect",
    coder: "Coder",
    debugger: "Debugger",
    security: "Security Auditor",
  };

  let userMessage = "";

  switch (role) {
    case "architect":
      userMessage = `Design the complete architecture for this task:\n\n${context.task}`;
      break;

    case "coder":
      userMessage = `Implement the following architecture completely:\n\n**TASK:**\n${context.task}\n\n**ARCHITECTURE:**\n${context.architecture}`;
      break;

    case "debugger":
      userMessage = `Review and debug this implementation:\n\n**TASK:**\n${context.task}\n\n**ARCHITECTURE:**\n${context.architecture}\n\n**IMPLEMENTATION:**\n${context.artifacts?.map(a => `\`\`\`${a.language}:${a.filename}\n${a.content}\n\`\`\``).join("\n\n") ?? "No code provided"}`;
      break;

    case "security":
      userMessage = `Perform a security audit of this implementation:\n\n**TASK:**\n${context.task}\n\n**CODE:**\n${context.artifacts?.map(a => `\`\`\`${a.language}:${a.filename}\n${a.content}\n\`\`\``).join("\n\n") ?? "No code provided"}\n\n**KNOWN BUGS (from Debugger):**\n${context.debugReport ?? "None"}`;
      break;
  }

  // v5.93: Use active provider (Claude via OpenRouter) instead of hardcoded DeepSeek.
  const { simpleChatCompletion } = await import("./llmProvider.js");
  const output: string = await simpleChatCompletion(
    [
      { role: "system", content: AGENT_PROMPTS[role] },
      { role: "user", content: userMessage },
    ],
    { maxTokens: 4000, temperature: role === "architect" ? 0.3 : role === "coder" ? 0.2 : 0.4 },
  );

  // Parse code artifacts from Coder output
  const artifacts: CodeArtifact[] = [];
  if (role === "coder") {
    const codeBlockRegex = /```(\w+):([^\n]+)\n([\s\S]*?)```/g;
    let match;
    while ((match = codeBlockRegex.exec(output)) !== null) {
      const [, language, filename, content] = match;
      artifacts.push({
        filename: filename.trim(),
        language: language.trim(),
        content: content.trim(),
        description: `Implemented by Coder agent`,
      });
    }
  }

  // Parse issues from Debugger/Security output
  const issues: Issue[] = [];
  if (role === "debugger" || role === "security") {
    const severityRegex = /\*\*Severity\*\*:\s*(critical|high|medium|low)/gi;
    const descRegex = /\*\*Description\*\*:\s*([^\n]+)/gi;
    const locationRegex = /\*\*Location\*\*:\s*([^\n]+)/gi;

    const severities: string[] = [];
    const descriptions: string[] = [];
    const locations: string[] = [];

    let m;
    while ((m = severityRegex.exec(output)) !== null) severities.push(m[1].toLowerCase());
    while ((m = descRegex.exec(output)) !== null) descriptions.push(m[1].trim());
    while ((m = locationRegex.exec(output)) !== null) locations.push(m[1].trim());

    for (let i = 0; i < Math.min(severities.length, descriptions.length); i++) {
      issues.push({
        severity: severities[i] as Issue["severity"],
        type: role === "security" ? "security" : "bug",
        location: locations[i] ?? "unknown",
        description: descriptions[i],
      });
    }
  }

  return { output, artifacts: artifacts.length > 0 ? artifacts : undefined, issues: issues.length > 0 ? issues : undefined };
}

// ─── Team Orchestrator (SSE streaming) ───────────────────────────────────────

export async function runTeamAgent(task: string, res: Response): Promise<void> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.write(`data: ${JSON.stringify({ type: "error", message: "DEEPSEEK_API_KEY not configured" })}\n\n`);
    res.end();
    return;
  }

  const context: TeamContext = { task };

  const agentSequence: Array<{ role: AgentRole; name: string; emoji: string }> = [
    { role: "architect", name: "Architect", emoji: "🏗️" },
    { role: "coder", name: "Coder", emoji: "💻" },
    { role: "debugger", name: "Debugger", emoji: "🐛" },
    { role: "security", name: "Security Auditor", emoji: "🔒" },
  ];

  const emit = (event: object) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  emit({ type: "team_start", task, agents: agentSequence.map(a => ({ role: a.role, name: a.name, emoji: a.emoji })) });

  for (const agent of agentSequence) {
    emit({
      type: "agent_start",
      role: agent.role,
      name: agent.name,
      emoji: agent.emoji,
      status: "thinking",
      timestamp: Date.now(),
    });

    try {
      const result = await runAgent(agent.role, context, apiKey);

      // Update shared context
      if (agent.role === "architect") {
        context.architecture = result.output;
      } else if (agent.role === "coder") {
        context.artifacts = result.artifacts ?? [];
      } else if (agent.role === "debugger") {
        context.debugReport = result.output;
        if (result.issues) context.issues = [...(context.issues ?? []), ...result.issues];
      } else if (agent.role === "security") {
        context.securityReport = result.output;
        if (result.issues) context.issues = [...(context.issues ?? []), ...result.issues];
      }

      emit({
        type: "agent_done",
        role: agent.role,
        name: agent.name,
        emoji: agent.emoji,
        status: "done",
        output: result.output,
        artifacts: result.artifacts,
        issues: result.issues,
        timestamp: Date.now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({
        type: "agent_error",
        role: agent.role,
        name: agent.name,
        emoji: agent.emoji,
        status: "error",
        message,
        timestamp: Date.now(),
      });
      // Continue with remaining agents even if one fails
    }
  }

  // Final summary
  const criticalCount = context.issues?.filter(i => i.severity === "critical").length ?? 0;
  const highCount = context.issues?.filter(i => i.severity === "high").length ?? 0;
  const artifactCount = context.artifacts?.length ?? 0;

  emit({
    type: "team_done",
    summary: {
      filesCreated: artifactCount,
      criticalIssues: criticalCount,
      highIssues: highCount,
      totalIssues: context.issues?.length ?? 0,
      artifacts: context.artifacts?.map(a => ({ filename: a.filename, language: a.language })) ?? [],
    },
    timestamp: Date.now(),
  });

  res.end();
}
