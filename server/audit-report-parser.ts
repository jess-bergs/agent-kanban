import { join, dirname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type {
  AuditReport,
  AuditRubricScore,
  AuditFinding,
  SeverityCounts,
  FindingSeverity,
  AuditRun,
} from '../src/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dirname, '..', 'data', 'reports');

/**
 * Parse structured JSON from agent output (```json fences).
 * Same pattern as parseAuditResult in auditor.ts.
 */
export function parseStructuredReport(output: string): AuditReport | null {
  const jsonMatch = output.match(/```json\s*\n([\s\S]*?)\n\s*```/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[1]);

    if (typeof parsed.overallScore !== 'number' || !Array.isArray(parsed.rubric)) {
      return null;
    }

    const rubric: AuditRubricScore[] = parsed.rubric.map((item: Record<string, unknown>) => ({
      aspect: String(item.aspect || ''),
      score: clampScore(item.score as number),
      rating: deriveRating(item.score as number),
      summary: String(item.summary || ''),
      findingCount: typeof item.findingCount === 'number' ? item.findingCount : 0,
    }));

    const findings: AuditFinding[] = (parsed.findings || []).map((f: Record<string, unknown>) => ({
      id: (f.id as string) || generateFindingId(f),
      severity: validSeverity(f.severity as string),
      aspect: String(f.aspect || ''),
      location: f.location ? String(f.location) : undefined,
      title: String(f.title || ''),
      description: String(f.description || ''),
      recommendation: f.recommendation ? String(f.recommendation) : undefined,
    }));

    return {
      overallScore: clampScore(parsed.overallScore),
      overallVerdict: String(parsed.overallVerdict || ''),
      summary: String(parsed.summary || ''),
      rubric,
      findings,
      severityCounts: computeSeverityCounts(findings),
      generatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(10, typeof score === 'number' ? score : 0));
}

function deriveRating(score: number): 'pass' | 'concern' | 'fail' {
  if (score >= 8) return 'pass';
  if (score >= 4) return 'concern';
  return 'fail';
}

const VALID_SEVERITIES = new Set<FindingSeverity>(['critical', 'high', 'medium', 'low', 'info']);

function validSeverity(s: string): FindingSeverity {
  const lower = (s || '').toLowerCase() as FindingSeverity;
  return VALID_SEVERITIES.has(lower) ? lower : 'info';
}

function computeSeverityCounts(findings: AuditFinding[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    counts[f.severity]++;
  }
  return counts;
}

/** Stable fingerprint for cross-run finding matching */
function generateFindingId(finding: Record<string, unknown>): string {
  const key = `${finding.severity}:${finding.aspect}:${finding.location || ''}:${finding.title}`;
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

/** Write the markdown report to data/reports/ and return the path */
export async function writeMarkdownReport(
  run: AuditRun,
  report: AuditReport,
  scheduleName: string,
  projectName: string,
): Promise<string> {
  await mkdir(REPORTS_DIR, { recursive: true });

  const date = new Date(report.generatedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = scheduleName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 40);
  const filename = `${date}-${slug}.md`;
  const filepath = join(REPORTS_DIR, filename);

  const md = renderReportMarkdown(report, scheduleName, projectName);
  await writeFile(filepath, md);

  return filepath;
}

function renderReportMarkdown(
  report: AuditReport,
  scheduleName: string,
  projectName: string,
): string {
  const lines: string[] = [];

  lines.push(`# ${scheduleName}`);
  lines.push('');
  lines.push(`**Project:** ${projectName}`);
  lines.push(`**Date:** ${new Date(report.generatedAt).toISOString()}`);
  lines.push(`**Overall Score:** ${report.overallScore.toFixed(1)}/10 — ${report.overallVerdict}`);
  lines.push('');

  // Severity summary
  const sc = report.severityCounts;
  lines.push('## Severity Summary');
  lines.push('');
  lines.push('| Critical | High | Medium | Low | Info |');
  lines.push('|----------|------|--------|-----|------|');
  lines.push(`| ${sc.critical} | ${sc.high} | ${sc.medium} | ${sc.low} | ${sc.info} |`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(report.summary);
  lines.push('');

  // Rubric table
  lines.push('## Rubric Scores');
  lines.push('');
  lines.push('| Aspect | Score | Rating | Findings | Notes |');
  lines.push('|--------|-------|--------|----------|-------|');
  for (const item of report.rubric) {
    const rating = item.rating.toUpperCase();
    lines.push(`| ${item.aspect} | ${item.score.toFixed(1)} | ${rating} | ${item.findingCount} | ${item.summary} |`);
  }
  lines.push('');

  // Findings
  if (report.findings.length > 0) {
    lines.push(`## Findings (${report.findings.length})`);
    lines.push('');

    const severityOrder: FindingSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
    for (const sev of severityOrder) {
      const items = report.findings.filter(f => f.severity === sev);
      if (items.length === 0) continue;

      lines.push(`### ${sev.toUpperCase()} (${items.length})`);
      lines.push('');
      for (const f of items) {
        lines.push(`- **${f.title}**${f.location ? ` (${f.location})` : ''}`);
        lines.push(`  ${f.description}`);
        if (f.recommendation) lines.push(`  *Recommendation:* ${f.recommendation}`);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}
