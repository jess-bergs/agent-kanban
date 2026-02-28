Review the project's dependencies for health and currency.

Check:
1. **Outdated packages**: Run appropriate commands (npm outdated, pip list --outdated, etc.) to find stale dependencies
2. **Security vulnerabilities**: Run npm audit or equivalent to check for known CVEs
3. **Unused dependencies**: Check if any declared dependencies are not actually imported anywhere in the code
4. **License compliance**: Note any dependencies with unusual or restrictive licenses
5. **Pinning strategy**: Are versions appropriately pinned? Any use of `*` or overly broad ranges?
6. **Peer dependency conflicts**: Are there any version conflicts between packages?

Produce a report with:
- Summary of dependency health (healthy / needs attention / critical)
- Table of outdated packages with current vs latest versions
- List of any security advisories
- List of unused dependencies that could be removed
- Recommendations prioritized by risk
