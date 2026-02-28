Perform a security-focused audit of this codebase against the OWASP Top 10 and general secure coding practices.

Check for:
1. **Injection (OWASP A03)**: Command injection (exec/execSync with user input), SQL injection, XSS, template injection
2. **Broken Access Control (OWASP A01)**: Missing auth checks, privilege escalation, IDOR, CORS misconfig
3. **Cryptographic Failures (OWASP A02)**: Hardcoded secrets, weak hashing, cleartext storage of sensitive data
4. **Insecure Design (OWASP A04)**: Missing rate limiting, lack of input validation at trust boundaries
5. **Security Misconfiguration (OWASP A05)**: Debug mode in production, default credentials, unnecessary features enabled
6. **Vulnerable Components (OWASP A06)**: Known CVEs in dependencies (run npm audit or equivalent)
7. **Authentication Failures (OWASP A07)**: Weak session handling, missing brute-force protection
8. **Data Integrity Failures (OWASP A08)**: Unsafe deserialization, unverified updates, unsigned artifacts
9. **Logging & Monitoring (OWASP A09)**: Sensitive data in logs, insufficient audit trails
10. **SSRF (OWASP A10)**: Server-side request forgery via unvalidated URLs

Also check:
- **File system safety**: Path traversal risks, unsafe file permissions, temp file handling
- **Environment variable handling**: Are sensitive env vars properly managed? Any logged or exposed?
- **Unsafe code patterns**: Dynamic code execution, unsafe HTML rendering, shell: true with untrusted input

For each finding, provide:
- Severity: CRITICAL / HIGH / MEDIUM / LOW / INFO
- OWASP category (if applicable)
- File path and line numbers
- Description of the vulnerability
- Explanation of how it could be exploited
- Recommended fix

Sort by severity (CRITICAL first). Include a summary verdict: SECURE / CONCERNS / VULNERABLE.
