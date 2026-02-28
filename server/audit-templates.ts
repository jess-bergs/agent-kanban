import type { AuditTemplateId, AuditCadence, AuditMode } from '../src/types.ts';

export interface AuditTemplate {
  id: AuditTemplateId;
  name: string;
  description: string;
  defaultMode: AuditMode;
  defaultCadence: AuditCadence;
  prompt: string;
}

export const AUDIT_TEMPLATES: Record<AuditTemplateId, AuditTemplate> = {
  'readme-freshness': {
    id: 'readme-freshness',
    name: 'README Freshness Check',
    description: 'Verify README.md is up-to-date with the current codebase',
    defaultMode: 'report',
    defaultCadence: 'weekly',
    prompt: `Review the README.md (and any other documentation files like CLAUDE.md, AGENTS.md, CONTRIBUTING.md) for accuracy and freshness.

Check for:
1. **Outdated instructions**: Do the build/run commands still work? Are dependency installation steps current?
2. **Missing sections**: Are there new features, scripts, or configuration options not documented?
3. **Broken links**: Check any URLs or file path references in the docs.
4. **Architecture drift**: Does the described project structure match the actual directory layout?
5. **Stale examples**: Do code examples and API usage patterns reflect the current implementation?

For each issue found, provide:
- The file and section where the issue exists
- What is outdated or missing
- What the correct/updated content should be

Conclude with a freshness score: FRESH (no issues), STALE (minor issues), or OUTDATED (significant drift).`,
  },

  'architecture-review': {
    id: 'architecture-review',
    name: 'Architecture Review',
    description: 'Analyze codebase architecture for patterns, coupling, and technical debt',
    defaultMode: 'report',
    defaultCadence: 'monthly',
    prompt: `Perform an architecture review of this codebase.

Analyze:
1. **Module boundaries**: Are responsibilities cleanly separated? Any circular dependencies?
2. **Coupling**: Are there components that are too tightly coupled? Could interfaces be clearer?
3. **Consistency**: Are naming conventions, file organization, and patterns consistent throughout?
4. **Scalability concerns**: Are there areas that will become problematic as the codebase grows?
5. **Error handling**: Is error handling consistent and comprehensive? Are failure modes well-defined?
6. **Configuration management**: Are there hardcoded values that should be configurable?

Produce a structured report with:
- An architecture overview (how things are organized today)
- A list of strengths (good patterns to preserve)
- A list of concerns (ordered by severity)
- Concrete recommendations for each concern`,
  },

  'improvement-opportunities': {
    id: 'improvement-opportunities',
    name: 'Improvement Opportunities',
    description: 'Identify code improvements, refactoring candidates, and quick wins',
    defaultMode: 'report',
    defaultCadence: 'weekly',
    prompt: `Scan the codebase for improvement opportunities. Focus on actionable, concrete changes.

Look for:
1. **Code duplication**: Repeated logic that could be extracted into shared utilities
2. **Dead code**: Unused exports, unreachable branches, commented-out code
3. **TODO/FIXME/HACK comments**: Catalog all technical debt markers and assess priority
4. **Type safety gaps**: Any use of \`any\`, type assertions, or missing type annotations
5. **Performance opportunities**: Obvious inefficiencies, missing caching, N+1 patterns
6. **Quick wins**: Small changes that would meaningfully improve code quality

For each opportunity, provide:
- File path and line numbers
- Description of the issue
- Suggested fix
- Estimated effort (trivial / small / medium)
- Priority (low / medium / high)

Sort by priority descending, then effort ascending (high-priority quick wins first).`,
  },

  'dependency-review': {
    id: 'dependency-review',
    name: 'Dependency Review',
    description: 'Check for outdated, vulnerable, or unused dependencies',
    defaultMode: 'report',
    defaultCadence: 'monthly',
    prompt: `Review the project's dependencies for health and currency.

Check:
1. **Outdated packages**: Run appropriate commands (npm outdated, pip list --outdated, etc.) to find stale dependencies
2. **Security vulnerabilities**: Run npm audit or equivalent to check for known CVEs
3. **Unused dependencies**: Check if any declared dependencies are not actually imported anywhere in the code
4. **License compliance**: Note any dependencies with unusual or restrictive licenses
5. **Pinning strategy**: Are versions appropriately pinned? Any use of \`*\` or overly broad ranges?
6. **Peer dependency conflicts**: Are there any version conflicts between packages?

Produce a report with:
- Summary of dependency health (healthy / needs attention / critical)
- Table of outdated packages with current vs latest versions
- List of any security advisories
- List of unused dependencies that could be removed
- Recommendations prioritized by risk`,
  },

  'security-scan': {
    id: 'security-scan',
    name: 'Security Scan',
    description: 'Check for OWASP Top 10 web security issues, leaked secrets, and unsafe patterns',
    defaultMode: 'report',
    defaultCadence: 'weekly',
    prompt: [
      'Perform a security-focused audit of this codebase against the OWASP Top 10 and general secure coding practices.',
      '',
      'Check for:',
      '1. **Injection (OWASP A03)**: Command injection (exec/execSync with user input), SQL injection, XSS, template injection',
      '2. **Broken Access Control (OWASP A01)**: Missing auth checks, privilege escalation, IDOR, CORS misconfig',
      '3. **Cryptographic Failures (OWASP A02)**: Hardcoded secrets, weak hashing, cleartext storage of sensitive data',
      '4. **Insecure Design (OWASP A04)**: Missing rate limiting, lack of input validation at trust boundaries',
      '5. **Security Misconfiguration (OWASP A05)**: Debug mode in production, default credentials, unnecessary features enabled',
      '6. **Vulnerable Components (OWASP A06)**: Known CVEs in dependencies (run npm audit or equivalent)',
      '7. **Authentication Failures (OWASP A07)**: Weak session handling, missing brute-force protection',
      '8. **Data Integrity Failures (OWASP A08)**: Unsafe deserialization, unverified updates, unsigned artifacts',
      '9. **Logging & Monitoring (OWASP A09)**: Sensitive data in logs, insufficient audit trails',
      '10. **SSRF (OWASP A10)**: Server-side request forgery via unvalidated URLs',
      '',
      'Also check:',
      '- **File system safety**: Path traversal risks, unsafe file permissions, temp file handling',
      '- **Environment variable handling**: Are sensitive env vars properly managed? Any logged or exposed?',
      '- **Unsafe code patterns**: Dynamic code execution, unsafe HTML rendering, shell: true with untrusted input',
      '',
      'For each finding, provide:',
      '- Severity: CRITICAL / HIGH / MEDIUM / LOW / INFO',
      '- OWASP category (if applicable)',
      '- File path and line numbers',
      '- Description of the vulnerability',
      '- Explanation of how it could be exploited',
      '- Recommended fix',
      '',
      'Sort by severity (CRITICAL first). Include a summary verdict: SECURE / CONCERNS / VULNERABLE.',
    ].join('\n'),
  },

  'ai-security': {
    id: 'ai-security',
    name: 'AI/LLM Security Audit',
    description: 'Check for LLM-specific security risks per OWASP Top 10 for LLM Applications',
    defaultMode: 'report',
    defaultCadence: 'weekly',
    prompt: [
      'Perform an AI/LLM security audit of this codebase based on the OWASP Top 10 for Large Language Model Applications.',
      '',
      '## OWASP LLM Top 10 Checks',
      '',
      '1. **Prompt Injection (LLM01)**: Review all prompts constructed from user input, ticket content, or external data.',
      '   Are there injection vectors where untrusted text is interpolated into system prompts or agent instructions?',
      '   Check for direct injection (user-controlled prompt content) and indirect injection (data from files, tickets, or APIs).',
      '',
      '2. **Insecure Output Handling (LLM02)**: Is LLM output used in shell commands, file writes, or rendered as HTML?',
      '   Are there missing sanitization steps between agent output and system actions?',
      '',
      '3. **Training Data Poisoning (LLM03)**: Not typically applicable to agent-based systems — skip unless custom fine-tuning is used.',
      '',
      '4. **Model Denial of Service (LLM04)**: Are there unbounded loops, recursive agent calls, or prompts that could cause excessive token usage?',
      '',
      '5. **Supply Chain Vulnerabilities (LLM05)**: Are MCP servers, plugins, or agent skills loaded from untrusted sources?',
      '   Check for unverified tool sources or unsigned agent configurations.',
      '',
      '6. **Sensitive Information Disclosure (LLM06)**: Could agents leak API keys, credentials, or PII through their output?',
      '   Check if sensitive data is included in prompts or visible in agent logs/reports.',
      '',
      '7. **Insecure Plugin/Tool Design (LLM07)**: Do tools/MCP servers validate their inputs?',
      '   Are there tools with excessive permissions (file write, shell access) that could be exploited?',
      '',
      '8. **Excessive Agency (LLM08)**: Do agents have more permissions than needed?',
      '   Check for overly broad tool access, missing permission boundaries, or agents that can modify critical infrastructure.',
      '',
      '9. **Overreliance (LLM09)**: Are agent outputs used in critical decisions without human review?',
      '   Check for auto-merge, auto-deploy, or other automated actions based on unvalidated agent output.',
      '',
      '10. **Model Theft (LLM10)**: Are API keys, model endpoints, or agent configurations exposed in public repos or logs?',
      '',
      '## Ticket & Agent Activity Audit',
      '',
      'Review recent tickets and agent activity for signs of compromise or misuse:',
      '- Tickets with suspicious instructions (attempts to override agent behavior, exfiltrate data, or bypass safety checks)',
      '- Agent runs that produced unexpected file modifications, network requests, or credential access',
      '- Any patterns suggesting prompt injection via ticket content or PR descriptions',
      '- Tool calls to sensitive operations (shell commands, file writes outside worktree, network requests)',
      '',
      '## Report Format',
      '',
      'For each finding, provide:',
      '- Severity: CRITICAL / HIGH / MEDIUM / LOW / INFO',
      '- OWASP LLM category (LLM01-LLM10)',
      '- File path and line numbers (if applicable)',
      '- Description of the risk',
      '- Attack scenario: how this could be exploited',
      '- Recommended mitigation',
      '',
      'Sort by severity (CRITICAL first). Include a summary verdict: SECURE / CONCERNS / VULNERABLE.',
    ].join('\n'),
  },
};

export function getTemplate(id: AuditTemplateId): AuditTemplate | undefined {
  return AUDIT_TEMPLATES[id];
}

export function listTemplates(): AuditTemplate[] {
  return Object.values(AUDIT_TEMPLATES);
}
