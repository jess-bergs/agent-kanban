import type { AuditReport, AuditTrend } from '../src/types.ts';

const STABLE_THRESHOLD = 0.5;

export function computeTrend(
  current: AuditReport,
  previous: AuditReport,
  previousRunId: string,
): AuditTrend {
  const delta = current.overallScore - previous.overallScore;

  let direction: AuditTrend['direction'] = 'stable';
  if (delta > STABLE_THRESHOLD) direction = 'improving';
  else if (delta < -STABLE_THRESHOLD) direction = 'declining';

  const currentIds = new Set(current.findings.map(f => f.id));
  const previousIds = new Set(previous.findings.map(f => f.id));

  const newFindings = [...currentIds].filter(id => !previousIds.has(id));
  const resolvedFindings = [...previousIds].filter(id => !currentIds.has(id));
  const recurringFindings = [...currentIds].filter(id => previousIds.has(id));

  const previousAspectMap = new Map(previous.rubric.map(r => [r.aspect, r.score]));
  const aspectDeltas = current.rubric.map(r => ({
    aspect: r.aspect,
    currentScore: r.score,
    previousScore: previousAspectMap.get(r.aspect) ?? 0,
    delta: r.score - (previousAspectMap.get(r.aspect) ?? 0),
  }));

  return {
    previousRunId,
    previousScore: previous.overallScore,
    currentScore: current.overallScore,
    delta,
    direction,
    newFindings,
    resolvedFindings,
    recurringFindings,
    aspectDeltas,
  };
}
