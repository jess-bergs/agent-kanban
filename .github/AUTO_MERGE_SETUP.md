# Auto-Merge with Claude PR Reviews - Quick Setup

This guide shows how to configure auto-merge to trigger when Claude PR review checks pass.

## Step 1: Add API Key Secret

```bash
# Go to: Settings → Secrets and variables → Actions → New repository secret
# Name: ANTHROPIC_API_KEY
# Value: your-anthropic-api-key
```

## Step 2: Configure Branch Protection

1. Go to **Settings** → **Branches**
2. Click **Add rule** or edit existing rule for `main`
3. Configure:
   - ✅ **Require a pull request before merging**
   - ✅ **Require status checks to pass before merging**
   - Search and add these checks:
     - `Claude Code Review`
     - `Claude Security Review`
   - ✅ **Require branches to be up to date before merging** (optional)
4. Click **Save changes**

> **Note**: The checks won't appear in the list until the workflow runs at least once. Create a test PR first, then configure branch protection.

## Step 3: Enable Auto-Merge on PRs

### Option A: GitHub UI
1. Open a pull request
2. Click **Enable auto-merge** button
3. Select merge method (squash/merge/rebase)
4. PR will auto-merge when all checks pass

### Option B: GitHub CLI
```bash
# Auto-merge with squash
gh pr merge <PR_NUMBER> --auto --squash

# Auto-merge with merge commit
gh pr merge <PR_NUMBER> --auto --merge

# Auto-merge with rebase
gh pr merge <PR_NUMBER> --auto --rebase
```

### Option C: Default Auto-Merge for All PRs

To enable auto-merge by default, add this to your workflow or use a separate workflow:

```yaml
name: Auto-Enable Auto-Merge

on:
  pull_request:
    types: [opened, reopened]

jobs:
  enable-auto-merge:
    runs-on: ubuntu-latest
    steps:
      - name: Enable auto-merge
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.pulls.updateBranch({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: context.issue.number,
              expected_head_sha: context.payload.pull_request.head.sha
            });
```

## How It Works

1. Developer creates PR
2. Claude workflows automatically trigger:
   - **Code Review**: Analyzes code quality, bugs, performance
   - **Security Review**: Scans for vulnerabilities
3. Both checks must pass (green ✓)
4. If auto-merge is enabled, PR automatically merges
5. If checks fail, PR author addresses issues and pushes updates
6. Checks re-run on each push until they pass

## Workflow Diagram

```
PR Created/Updated
       ↓
[Claude Code Review] ──→ ✓ Pass
       ↓
[Claude Security Review] ──→ ✓ Pass
       ↓
[All Checks Passed]
       ↓
  Auto-Merge → Merged! 🎉
```

## Troubleshooting

### Auto-merge button is disabled
- Ensure all required checks are configured in branch protection
- Verify you have write permissions to the repository
- Check that the base branch is protected

### Checks don't appear in branch protection
- Create a test PR to trigger the workflow first
- Wait for the workflow to complete
- Refresh the branch protection settings page
- The check names will appear in the search box

### Workflow fails with "Resource not accessible by integration"
- Verify `ANTHROPIC_API_KEY` is set correctly
- Check that the API key has Claude Code enabled
- Ensure workflow permissions include `pull-requests: write`

### Auto-merge doesn't trigger
- Verify all required checks are passing (green)
- Check that auto-merge was enabled on the PR
- Ensure branch is up to date (if required by settings)
- Review workflow logs in Actions tab

## Security Best Practice

⚠️ **Protect Against Prompt Injection**

Enable in **Settings** → **Actions** → **General**:
- ✅ **Require approval for all outside collaborators**
- ✅ **Require approval for first-time contributors**

This prevents malicious PRs from external contributors from injecting prompts into Claude reviews.

## Advanced: Conditional Auto-Merge

You might want different rules for different PRs:

```yaml
# Only auto-merge if PR is from dependabot or labeled "automerge"
- name: Conditional Auto-Merge
  if: |
    github.actor == 'dependabot[bot]' ||
    contains(github.event.pull_request.labels.*.name, 'automerge')
  run: gh pr merge ${{ github.event.pull_request.number }} --auto --squash
```

## Testing Your Setup

1. Create a test branch: `git checkout -b test-claude-review`
2. Make a small change and commit
3. Push and create PR: `gh pr create --fill`
4. Verify both Claude checks appear and run
5. Once checks pass, enable auto-merge
6. Confirm PR merges automatically

## Cost Considerations

- Claude API costs apply per review
- Consider limiting to specific branches or PRs
- Use conditional triggers to reduce costs:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches:
      - main
      - develop
```

## Next Steps

- Customize review criteria in the workflow file
- Add custom security scanning rules
- Configure false positive filtering
- Set up Slack/email notifications for failed reviews

For detailed configuration, see [CLAUDE_REVIEW_SETUP.md](./CLAUDE_REVIEW_SETUP.md).
