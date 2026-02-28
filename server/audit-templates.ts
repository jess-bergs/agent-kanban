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
    description: 'Check for common security issues, leaked secrets, and unsafe patterns',
    defaultMode: 'report',
    defaultCadence: 'weekly',
    prompt: [
      'Perform a security-focused audit of this codebase.',
      '',
      'Check for:',
      '1. **Hardcoded secrets**: API keys, passwords, tokens, connection strings in source code',
      '2. **Injection vulnerabilities**: Command injection (exec/execSync with user input), SQL injection, XSS',
      '3. **Unsafe patterns**: Dynamic code execution, unsafe HTML rendering, shell: true with untrusted input',
      '4. **Authentication/Authorization gaps**: Missing auth checks, privilege escalation paths',
      '5. **Input validation**: Are system boundaries (API endpoints, CLI args, file reads) properly validated?',
      '6. **File system safety**: Path traversal risks, unsafe file permissions, temp file handling',
      '7. **Environment variable handling**: Are sensitive env vars properly managed? Any logged or exposed?',
      '8. **Dependency security**: Check for known vulnerabilities in dependencies',
      '',
      'For each finding, provide:',
      '- Severity: CRITICAL / HIGH / MEDIUM / LOW / INFO',
      '- File path and line numbers',
      '- Description of the vulnerability',
      '- Explanation of how it could be exploited',
      '- Recommended fix',
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
