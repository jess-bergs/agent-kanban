import { describe, it, expect } from 'vitest';
import { parseStructuredReport } from '../server/audit-report-parser.ts';

describe('parseStructuredReport', () => {
  const validReport = `
Some preamble text from the agent...

\`\`\`json
{
  "overallScore": 7.5,
  "overallVerdict": "Generally good",
  "summary": "The codebase is well-structured.",
  "rubric": [
    {
      "aspect": "Code Quality",
      "score": 8,
      "summary": "Clean code",
      "findingCount": 1
    },
    {
      "aspect": "Security",
      "score": 6,
      "summary": "Some concerns",
      "findingCount": 2
    }
  ],
  "findings": [
    {
      "severity": "high",
      "aspect": "Security",
      "title": "Missing input validation",
      "description": "User input is not validated",
      "location": "server/index.ts:42",
      "recommendation": "Add validation"
    },
    {
      "severity": "medium",
      "aspect": "Security",
      "title": "No rate limiting",
      "description": "API has no rate limiting"
    },
    {
      "severity": "low",
      "aspect": "Code Quality",
      "title": "Unused import",
      "description": "Unused import in utils.ts"
    }
  ]
}
\`\`\`

Some trailing text...
`;

  it('extracts JSON from markdown fences', () => {
    const report = parseStructuredReport(validReport);
    expect(report).not.toBeNull();
    expect(report!.overallScore).toBe(7.5);
    expect(report!.overallVerdict).toBe('Generally good');
    expect(report!.summary).toBe('The codebase is well-structured.');
  });

  it('parses rubric scores correctly', () => {
    const report = parseStructuredReport(validReport)!;
    expect(report.rubric).toHaveLength(2);
    expect(report.rubric[0].aspect).toBe('Code Quality');
    expect(report.rubric[0].score).toBe(8);
    expect(report.rubric[0].rating).toBe('pass'); // >= 8
    expect(report.rubric[1].score).toBe(6);
    expect(report.rubric[1].rating).toBe('concern'); // >= 4, < 8
  });

  it('derives ratings correctly from scores', () => {
    const report = parseStructuredReport(`
\`\`\`json
{
  "overallScore": 2,
  "rubric": [
    { "aspect": "A", "score": 9, "summary": "", "findingCount": 0 },
    { "aspect": "B", "score": 5, "summary": "", "findingCount": 0 },
    { "aspect": "C", "score": 3, "summary": "", "findingCount": 0 }
  ],
  "findings": []
}
\`\`\`
`)!;
    expect(report.rubric[0].rating).toBe('pass');    // 9 >= 8
    expect(report.rubric[1].rating).toBe('concern'); // 5 >= 4
    expect(report.rubric[2].rating).toBe('fail');    // 3 < 4
  });

  it('computes severity counts correctly', () => {
    const report = parseStructuredReport(validReport)!;
    expect(report.severityCounts).toEqual({
      critical: 0,
      high: 1,
      medium: 1,
      low: 1,
      info: 0,
    });
  });

  it('generates stable finding IDs', () => {
    const report1 = parseStructuredReport(validReport)!;
    const report2 = parseStructuredReport(validReport)!;
    // Same input should produce same finding IDs
    expect(report1.findings.map(f => f.id)).toEqual(report2.findings.map(f => f.id));
  });

  it('returns null for output without JSON fence', () => {
    expect(parseStructuredReport('Just some text, no JSON here')).toBeNull();
  });

  it('returns null for invalid JSON in fence', () => {
    expect(parseStructuredReport('```json\nnot valid json\n```')).toBeNull();
  });

  it('returns null for JSON missing required fields', () => {
    expect(parseStructuredReport('```json\n{"foo": "bar"}\n```')).toBeNull();
  });

  it('clamps scores to 0-10 range', () => {
    const report = parseStructuredReport(`
\`\`\`json
{
  "overallScore": 15,
  "rubric": [{ "aspect": "A", "score": -3, "summary": "", "findingCount": 0 }],
  "findings": []
}
\`\`\`
`)!;
    expect(report.overallScore).toBe(10);
    expect(report.rubric[0].score).toBe(0);
  });

  it('normalizes unknown severities to info', () => {
    const report = parseStructuredReport(`
\`\`\`json
{
  "overallScore": 5,
  "rubric": [],
  "findings": [
    { "severity": "BANANA", "aspect": "X", "title": "T", "description": "D" }
  ]
}
\`\`\`
`)!;
    expect(report.findings[0].severity).toBe('info');
  });
});
