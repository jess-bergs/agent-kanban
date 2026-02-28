import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuditTemplateId, AuditCadence, AuditMode, RubricAspectDefinition } from '../src/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'audit-templates');

function loadPrompt(filename: string): string {
  return readFileSync(join(TEMPLATES_DIR, filename), 'utf-8').trim();
}

export interface AuditTemplate {
  id: AuditTemplateId;
  name: string;
  description: string;
  defaultMode: AuditMode;
  defaultCadence: AuditCadence;
  prompt: string;
  rubric: RubricAspectDefinition[];
  verdictLabels: string[];
}

export const AUDIT_TEMPLATES: Record<AuditTemplateId, AuditTemplate> = {
  'readme-freshness': {
    id: 'readme-freshness',
    name: 'README Freshness Check',
    description: 'Verify README.md is up-to-date with the current codebase',
    defaultMode: 'report',
    defaultCadence: 'weekly',
    prompt: loadPrompt('readme-freshness.md'),
    rubric: [
      { aspect: 'Build Instructions', description: 'Build/run commands accuracy', weight: 1.5 },
      { aspect: 'Feature Coverage', description: 'New features documented', weight: 1.0 },
      { aspect: 'Link Integrity', description: 'URLs and file references valid', weight: 0.5 },
      { aspect: 'Architecture Accuracy', description: 'Structure matches reality', weight: 1.5 },
      { aspect: 'Example Currency', description: 'Code examples reflect current API', weight: 1.0 },
    ],
    verdictLabels: ['FRESH', 'STALE', 'OUTDATED'],
  },

  'architecture-review': {
    id: 'architecture-review',
    name: 'Architecture Review',
    description: 'Analyze codebase architecture for patterns, coupling, and technical debt',
    defaultMode: 'report',
    defaultCadence: 'monthly',
    prompt: loadPrompt('architecture-review.md'),
    rubric: [
      { aspect: 'Module Boundaries', description: 'Clean separation of concerns', weight: 1.5 },
      { aspect: 'Coupling', description: 'Interface clarity, dependency direction', weight: 1.5 },
      { aspect: 'Consistency', description: 'Naming, file org, pattern uniformity', weight: 1.0 },
      { aspect: 'Scalability', description: 'Growth bottlenecks', weight: 1.0 },
      { aspect: 'Error Handling', description: 'Consistent, comprehensive error paths', weight: 1.0 },
      { aspect: 'Configuration', description: 'Hardcoded values, configurability', weight: 0.5 },
    ],
    verdictLabels: ['SOUND', 'MIXED', 'FRAGILE'],
  },

  'improvement-opportunities': {
    id: 'improvement-opportunities',
    name: 'Improvement Opportunities',
    description: 'Identify code improvements, refactoring candidates, and quick wins',
    defaultMode: 'report',
    defaultCadence: 'weekly',
    prompt: loadPrompt('improvement-opportunities.md'),
    rubric: [
      { aspect: 'Code Duplication', description: 'Repeated logic that could be shared', weight: 1.0 },
      { aspect: 'Dead Code', description: 'Unused exports, unreachable branches', weight: 0.5 },
      { aspect: 'Technical Debt', description: 'TODO/FIXME/HACK markers', weight: 1.0 },
      { aspect: 'Type Safety', description: 'any usage, missing annotations', weight: 1.0 },
      { aspect: 'Performance', description: 'Inefficiencies, missing caching', weight: 1.5 },
      { aspect: 'Quick Wins', description: 'Low-effort high-impact improvements', weight: 1.0 },
    ],
    verdictLabels: ['CLEAN', 'OPPORTUNITIES', 'DEBT_HEAVY'],
  },

  'dependency-review': {
    id: 'dependency-review',
    name: 'Dependency Review',
    description: 'Check for outdated, vulnerable, or unused dependencies',
    defaultMode: 'report',
    defaultCadence: 'monthly',
    prompt: loadPrompt('dependency-review.md'),
    rubric: [
      { aspect: 'Currency', description: 'Outdated package versions', weight: 1.0 },
      { aspect: 'Security', description: 'Known CVEs and advisories', weight: 2.0 },
      { aspect: 'Unused Dependencies', description: 'Dead weight in dependency tree', weight: 0.5 },
      { aspect: 'License Compliance', description: 'Restrictive or unusual licenses', weight: 1.0 },
      { aspect: 'Version Pinning', description: 'Appropriate version constraints', weight: 0.5 },
      { aspect: 'Peer Conflicts', description: 'Version conflicts between packages', weight: 1.0 },
    ],
    verdictLabels: ['HEALTHY', 'NEEDS_ATTENTION', 'CRITICAL'],
  },

  'security-scan': {
    id: 'security-scan',
    name: 'Security Scan',
    description: 'Check for OWASP Top 10 web security issues, leaked secrets, and unsafe patterns',
    defaultMode: 'report',
    defaultCadence: 'weekly',
    prompt: loadPrompt('security-scan.md'),
    rubric: [
      { aspect: 'Injection', description: 'Command injection, XSS, SQL injection', weight: 2.0 },
      { aspect: 'Access Control', description: 'Auth checks, privilege escalation, CORS', weight: 2.0 },
      { aspect: 'Cryptographic Failures', description: 'Secrets, hashing, cleartext data', weight: 1.5 },
      { aspect: 'Insecure Design', description: 'Rate limiting, input validation', weight: 1.0 },
      { aspect: 'Misconfiguration', description: 'Debug mode, defaults, unnecessary features', weight: 1.0 },
      { aspect: 'Vulnerable Components', description: 'Known CVEs in dependencies', weight: 1.5 },
      { aspect: 'Data Integrity', description: 'Unsafe deserialization, unverified updates', weight: 1.0 },
      { aspect: 'Logging & Monitoring', description: 'Sensitive data in logs, audit trails', weight: 0.5 },
      { aspect: 'SSRF', description: 'Server-side request forgery', weight: 1.0 },
      { aspect: 'File System Safety', description: 'Path traversal, temp files, permissions', weight: 1.0 },
    ],
    verdictLabels: ['SECURE', 'CONCERNS', 'VULNERABLE'],
  },

  'ai-security': {
    id: 'ai-security',
    name: 'AI/LLM Security Audit',
    description: 'Check for LLM-specific security risks per OWASP Top 10 for LLM Applications',
    defaultMode: 'report',
    defaultCadence: 'weekly',
    prompt: loadPrompt('ai-security.md'),
    rubric: [
      { aspect: 'Prompt Injection', description: 'Direct and indirect injection vectors', weight: 2.0 },
      { aspect: 'Output Handling', description: 'LLM output used unsafely in commands/HTML', weight: 2.0 },
      { aspect: 'Denial of Service', description: 'Unbounded loops, excessive token usage', weight: 1.0 },
      { aspect: 'Supply Chain', description: 'Unverified MCP servers, plugins, skills', weight: 1.5 },
      { aspect: 'Information Disclosure', description: 'Secrets/PII leaked via agent output', weight: 1.5 },
      { aspect: 'Tool/Plugin Security', description: 'Input validation, permission scope', weight: 1.5 },
      { aspect: 'Excessive Agency', description: 'Overly broad permissions, missing boundaries', weight: 1.0 },
      { aspect: 'Overreliance', description: 'Auto-merge/deploy without human review', weight: 1.0 },
    ],
    verdictLabels: ['SECURE', 'CONCERNS', 'VULNERABLE'],
  },
};

export function getTemplate(id: AuditTemplateId): AuditTemplate | undefined {
  return AUDIT_TEMPLATES[id];
}

export function listTemplates(): AuditTemplate[] {
  return Object.values(AUDIT_TEMPLATES);
}
