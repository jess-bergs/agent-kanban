import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuditTemplateId, AuditCadence, AuditMode } from '../src/types.ts';

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
}

export const AUDIT_TEMPLATES: Record<AuditTemplateId, AuditTemplate> = {
  'readme-freshness': {
    id: 'readme-freshness',
    name: 'README Freshness Check',
    description: 'Verify README.md is up-to-date with the current codebase',
    defaultMode: 'report',
    defaultCadence: 'weekly',
    prompt: loadPrompt('readme-freshness.md'),
  },

  'architecture-review': {
    id: 'architecture-review',
    name: 'Architecture Review',
    description: 'Analyze codebase architecture for patterns, coupling, and technical debt',
    defaultMode: 'report',
    defaultCadence: 'monthly',
    prompt: loadPrompt('architecture-review.md'),
  },

  'improvement-opportunities': {
    id: 'improvement-opportunities',
    name: 'Improvement Opportunities',
    description: 'Identify code improvements, refactoring candidates, and quick wins',
    defaultMode: 'report',
    defaultCadence: 'weekly',
    prompt: loadPrompt('improvement-opportunities.md'),
  },

  'dependency-review': {
    id: 'dependency-review',
    name: 'Dependency Review',
    description: 'Check for outdated, vulnerable, or unused dependencies',
    defaultMode: 'report',
    defaultCadence: 'monthly',
    prompt: loadPrompt('dependency-review.md'),
  },

  'security-scan': {
    id: 'security-scan',
    name: 'Security Scan',
    description: 'Check for OWASP Top 10 web security issues, leaked secrets, and unsafe patterns',
    defaultMode: 'report',
    defaultCadence: 'weekly',
    prompt: loadPrompt('security-scan.md'),
  },

  'ai-security': {
    id: 'ai-security',
    name: 'AI/LLM Security Audit',
    description: 'Check for LLM-specific security risks per OWASP Top 10 for LLM Applications',
    defaultMode: 'report',
    defaultCadence: 'weekly',
    prompt: loadPrompt('ai-security.md'),
  },
};

export function getTemplate(id: AuditTemplateId): AuditTemplate | undefined {
  return AUDIT_TEMPLATES[id];
}

export function listTemplates(): AuditTemplate[] {
  return Object.values(AUDIT_TEMPLATES);
}
