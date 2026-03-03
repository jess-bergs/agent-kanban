import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const DEFAULT_PR_TEMPLATE = `# Description

<!-- Provide a brief description of what this PR does -->

## Changes

<!-- List the main changes in this PR -->
-
-
-

## Type of Change

<!-- Mark with an 'x' all that apply -->
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Refactoring (no functional changes)
- [ ] Documentation update
- [ ] UI/UX improvement

## Screenshots

<!-- If this PR includes UI changes, add screenshots here -->

### Before


### After


## Testing

<!-- Describe how you tested these changes -->
- [ ] Tested locally
- [ ] Verified in development environment
- [ ] Visual inspection completed

## Checklist

- [ ] My code follows the project's code style
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] My changes generate no new warnings

## Screenshots (choose one)

<!-- If you made UI changes and can capture screenshots, check the first box and add images in the Screenshots section above. -->
<!-- If no UI changes were made, or screenshots cannot be captured, check the second box and explain why in the Screenshots section above. -->
- [ ] Screenshots added (UI changes made and images provided above)
- [ ] Not applicable (no UI changes, or screenshots not possible — explain in Screenshots section)

## Ticket

<!-- If dispatched by Agent Kanban, the ticket ID will be added here automatically -->

## Related Issues

<!-- Link any related issues here -->
Closes #

## Additional Notes

<!-- Add any additional information that reviewers should know -->
`;

/**
 * Ensures a `.github/pull_request_template.md` exists in the given repo.
 * If the file already exists, this is a no-op.
 * Returns true if a new template was created, false if it already existed.
 */
export async function ensurePrTemplate(repoPath: string): Promise<boolean> {
  const githubDir = join(repoPath, '.github');
  const templatePath = join(githubDir, 'pull_request_template.md');

  if (existsSync(templatePath)) {
    return false;
  }

  await mkdir(githubDir, { recursive: true });
  await writeFile(templatePath, DEFAULT_PR_TEMPLATE);
  console.log(`[pr-template] Created PR template at ${templatePath}`);
  return true;
}
