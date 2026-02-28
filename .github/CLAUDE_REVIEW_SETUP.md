# Claude PR Review Setup Guide

This repository uses Claude AI for automated pull request reviews as a required check for auto-merge. The workflow includes both general code review and security-focused analysis.

## Prerequisites

1. **Anthropic API Key**: You need an API key from Anthropic with both Claude API and Claude Code enabled.
2. **GitHub Permissions**: Repository admin access to configure secrets and branch protection.
3. **Actions Approval**: For security, enable "Require approval for all external contributors" in Settings → Actions to prevent prompt injection from untrusted PRs.

## Setup Steps

### 1. Add Anthropic API Key to GitHub Secrets

1. Go to your repository settings
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `ANTHROPIC_API_KEY`
5. Value: Your Anthropic API key
6. Click **Add secret**

### 2. Configure Branch Protection Rules

To make Claude PR Review a required check for auto-merge:

1. Go to **Settings** → **Branches**
2. Add or edit a branch protection rule for your main branch (e.g., `main`)
3. Enable **Require status checks to pass before merging**
4. Search for and select the following checks:
   - **Claude Code Review** - General code quality and best practices
   - **Claude Security Review** - Security vulnerability detection
   - Note: These checks will only appear after the workflow runs for the first time
5. Optionally enable **Require branches to be up to date before merging**
6. Save changes

### 3. Enable Auto-Merge

Once branch protection is configured, you can enable auto-merge on pull requests:

#### Via GitHub UI:
1. Open a pull request
2. Click **Enable auto-merge** (appears when all conditions are met)
3. Select merge method (merge commit, squash, or rebase)
4. The PR will automatically merge when Claude PR Review and other required checks pass

#### Via GitHub CLI:
```bash
gh pr merge <PR_NUMBER> --auto --squash
```

## How It Works

1. **Trigger**: The workflow runs automatically when a PR is opened, updated, or reopened
2. **Parallel Reviews**: Two separate jobs run simultaneously:
   - **Code Review**: Analyzes code quality, best practices, potential bugs, performance, and maintainability
   - **Security Review**: Scans for security vulnerabilities including injection attacks, authentication issues, data exposure, and more
3. **Status Checks**: Both jobs report their status independently as GitHub checks
4. **PR Comments**: Claude posts detailed review comments directly on your PR
5. **Auto-Merge**: When all required checks pass (including both Claude reviews), the PR auto-merges

## Customization

### Customize Review Criteria

Edit the `prompt` in the code-review job (`.github/workflows/claude-pr-review.yml`):

```yaml
- name: Run Claude Code Review
  uses: anthropics/claude-code-action@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    prompt: |
      Review this pull request focusing on:
      - Your custom criteria here
      - TypeScript best practices
      - React performance patterns
```

### Configure Security Exclusions

Exclude directories from security scanning:

```yaml
- name: Run Claude Security Review
  uses: anthropics/claude-code-security-review@main
  with:
    claude-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    comment-pr: true
    exclude-directories: "node_modules,dist,build,vendor"
```

### Custom Security Rules

Create `.claude/security-scan.txt` with custom security instructions:

```yaml
- name: Run Claude Security Review
  uses: anthropics/claude-code-security-review@main
  with:
    claude-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    comment-pr: true
    custom-security-scan-instructions: ".claude/security-scan.txt"
```

### Adjust Workflow Triggers

By default, the workflow runs on `opened`, `synchronize`, and `reopened` PR events. You can customize in the workflow file:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
```

## Troubleshooting

### Check doesn't appear in branch protection
- The check only becomes available after the workflow runs at least once
- Create a test PR to trigger the workflow, then configure branch protection

### Workflow fails immediately
- Verify `ANTHROPIC_API_KEY` is set correctly in repository secrets
- Check workflow run logs in the **Actions** tab

### Auto-merge doesn't trigger
- Ensure all required status checks are passing
- Verify branch protection rules are properly configured
- Check that the branch is up to date if that option is enabled

## Security Considerations

⚠️ **Important**: The security review action is not hardened against prompt injection attacks. Always:
- Enable "Require approval for all external contributors" in Settings → Actions → General
- Only run on PRs from trusted contributors
- Review the workflow logs for suspicious activity

## What Gets Scanned

The security review detects:
- **Injection Attacks**: SQL, command, LDAP, XPath, NoSQL, XXE
- **Authentication & Authorization**: Privilege escalation, broken auth, IDOR
- **Data Exposure**: Hardcoded secrets, sensitive data logging, PII violations
- **Cryptographic Issues**: Weak algorithms, poor key management
- **Input Validation**: Missing validation, buffer overflows
- **Business Logic Flaws**: Race conditions, TOCTOU issues
- **XSS**: Reflected, stored, DOM-based

## Additional Resources

- [Claude Code Action Repository](https://github.com/anthropics/claude-code-action)
- [Claude Security Review Repository](https://github.com/anthropics/claude-code-security-review)
- [Claude Code Documentation](https://code.claude.com/docs/en/github-actions)
- [GitHub Branch Protection Rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub Auto-Merge](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request)
