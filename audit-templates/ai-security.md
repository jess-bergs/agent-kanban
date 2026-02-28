Perform an AI/LLM security audit of this codebase based on the OWASP Top 10 for Large Language Model Applications.

## OWASP LLM Top 10 Checks

1. **Prompt Injection (LLM01)**: Review all prompts constructed from user input, ticket content, or external data.
   Are there injection vectors where untrusted text is interpolated into system prompts or agent instructions?
   Check for direct injection (user-controlled prompt content) and indirect injection (data from files, tickets, or APIs).

2. **Insecure Output Handling (LLM02)**: Is LLM output used in shell commands, file writes, or rendered as HTML?
   Are there missing sanitization steps between agent output and system actions?

3. **Training Data Poisoning (LLM03)**: Not typically applicable to agent-based systems — skip unless custom fine-tuning is used.

4. **Model Denial of Service (LLM04)**: Are there unbounded loops, recursive agent calls, or prompts that could cause excessive token usage?

5. **Supply Chain Vulnerabilities (LLM05)**: Are MCP servers, plugins, or agent skills loaded from untrusted sources?
   Check for unverified tool sources or unsigned agent configurations.

6. **Sensitive Information Disclosure (LLM06)**: Could agents leak API keys, credentials, or PII through their output?
   Check if sensitive data is included in prompts or visible in agent logs/reports.

7. **Insecure Plugin/Tool Design (LLM07)**: Do tools/MCP servers validate their inputs?
   Are there tools with excessive permissions (file write, shell access) that could be exploited?

8. **Excessive Agency (LLM08)**: Do agents have more permissions than needed?
   Check for overly broad tool access, missing permission boundaries, or agents that can modify critical infrastructure.

9. **Overreliance (LLM09)**: Are agent outputs used in critical decisions without human review?
   Check for auto-merge, auto-deploy, or other automated actions based on unvalidated agent output.

10. **Model Theft (LLM10)**: Are API keys, model endpoints, or agent configurations exposed in public repos or logs?

## Ticket & Agent Activity Audit

Review recent tickets and agent activity for signs of compromise or misuse:
- Tickets with suspicious instructions (attempts to override agent behavior, exfiltrate data, or bypass safety checks)
- Agent runs that produced unexpected file modifications, network requests, or credential access
- Any patterns suggesting prompt injection via ticket content or PR descriptions
- Tool calls to sensitive operations (shell commands, file writes outside worktree, network requests)

## Report Format

For each finding, provide:
- Severity: CRITICAL / HIGH / MEDIUM / LOW / INFO
- OWASP LLM category (LLM01-LLM10)
- File path and line numbers (if applicable)
- Description of the risk
- Attack scenario: how this could be exploited
- Recommended mitigation

Sort by severity (CRITICAL first). Include a summary verdict: SECURE / CONCERNS / VULNERABLE.
