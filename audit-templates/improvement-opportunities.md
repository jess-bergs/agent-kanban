Scan the codebase for improvement opportunities. Focus on actionable, concrete changes.

Look for:
1. **Code duplication**: Repeated logic that could be extracted into shared utilities
2. **Dead code**: Unused exports, unreachable branches, commented-out code
3. **TODO/FIXME/HACK comments**: Catalog all technical debt markers and assess priority
4. **Type safety gaps**: Any use of `any`, type assertions, or missing type annotations
5. **Performance opportunities**: Obvious inefficiencies, missing caching, N+1 patterns
6. **Quick wins**: Small changes that would meaningfully improve code quality

For each opportunity, provide:
- File path and line numbers
- Description of the issue
- Suggested fix
- Estimated effort (trivial / small / medium)
- Priority (low / medium / high)

Sort by priority descending, then effort ascending (high-priority quick wins first).
