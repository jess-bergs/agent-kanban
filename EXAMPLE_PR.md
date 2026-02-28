# Example Pull Request with Screenshots

This is an example of how to create a well-documented pull request with screenshots for the Agent Kanban project.

---

## Pull Request: Add Screenshot Generation Tools

### Description

This PR adds comprehensive screenshot generation tools and documentation to make it easier to include visual documentation in pull requests.

### Changes

- Added PR template at `.github/pull_request_template.md`
- Created screenshot generation script (`npm run screenshot`)
- Added Playwright automation guide
- Created comprehensive screenshot documentation
- Set up screenshots directory structure

### Type of Change

- [x] Documentation update
- [x] New feature (screenshot tooling)
- [ ] Bug fix
- [ ] Breaking change
- [ ] Refactoring

### Screenshots

Since this PR is about adding screenshot tooling (meta!), here's what the new documentation structure looks like:

#### New Directory Structure

```
.github/
  └── pull_request_template.md    # PR template with screenshot section
scripts/
  ├── generate-screenshots.ts     # Automated screenshot script
  └── capture-with-playwright.md  # Playwright automation guide
screenshots/
  ├── README.md                   # Screenshot directory documentation
  └── .gitkeep                    # Keeps directory in git
SCREENSHOT_GUIDE.md               # Comprehensive user guide
```

#### PR Template Preview

The new PR template includes a dedicated Screenshots section:

```markdown
## Screenshots

### Before
[Add screenshots of before state]

### After
[Add screenshots of after state]
```

#### Screenshot Script in Action

When you run `npm run screenshot`, you'll see:

```bash
$ npm run screenshot

📸 Agent Kanban Screenshot Generator

✓ Screenshots directory: /path/to/screenshots
🚀 Starting development server...
✓ Server is ready!
📸 Capturing screenshots...

# Screenshot Capture Instructions

The development server is now running at: http://localhost:5173

[... detailed instructions ...]
```

### Testing

- [x] Tested script execution (`npm run screenshot`)
- [x] Verified PR template renders correctly on GitHub
- [x] Validated documentation completeness
- [x] Confirmed directory structure is git-tracked

### Why Screenshots Matter

Screenshots in PRs provide immediate visual context:

1. **Faster Reviews**: Reviewers can see changes without running code
2. **Better Context**: Visual changes are easier to understand with images
3. **Historical Record**: Screenshots document how the UI evolved
4. **Accessibility**: Not everyone can easily run the dev environment

### Usage Example

For future PRs, developers will:

1. Make their UI changes
2. Run `npm run screenshot` to start the server
3. Capture relevant views (manually or with Playwright via Claude Code)
4. Add screenshots to the PR using the template
5. Reference screenshots in their description

### Implementation Notes

**Why not fully automated?**

- Git worktrees don't share node_modules
- Browser automation adds heavy dependencies
- Different PRs need different screenshots
- Manual curation ensures relevance

**Why this approach?**

- Leverages Claude Code's Playwright MCP tools
- Provides clear manual fallback
- Keeps project dependencies minimal
- Flexible for different use cases

### Breaking Changes

None. This is purely additive.

### Related Issues

Closes #14 - Add screenshot generation capability

### Additional Notes

**For Reviewers:**

This PR adds tooling infrastructure. Future PRs using these tools will be easier to review because they'll include visual documentation.

**For Contributors:**

Check out `SCREENSHOT_GUIDE.md` for comprehensive documentation on using these tools.

---

## Example Workflow for Future PRs

Here's how a developer would use this tooling in a real PR:

### Step 1: Make Changes

```bash
git checkout -b feature/new-ticket-filters
# ... make code changes ...
```

### Step 2: Generate Screenshots

```bash
npm run screenshot
# Server starts automatically
# Follow on-screen instructions
```

### Step 3: Capture Relevant Views

**Option A: Manual**
- Navigate to http://localhost:5173
- Use OS screenshot tool
- Save to screenshots/

**Option B: Automated (Claude Code)**
- Ask Claude Code to capture screenshots with Playwright
- Specify which views to capture
- Screenshots saved automatically

### Step 4: Create PR with Template

```bash
gh pr create --base main --fill
```

The PR template automatically includes the Screenshots section.

### Step 5: Add Screenshots to PR Description

Edit the PR description to include:

```markdown
## Screenshots

### New Filter Interface

![Filter dropdown](screenshots/ticket-filter-dropdown.png)

Added a dropdown to filter tickets by status.

### Filter in Action

![Filtered view](screenshots/tickets-filtered-by-status.png)

Tickets filtered to show only "In Progress" items.
```

---

## Benefits

### For Reviewers

- ✅ See UI changes immediately
- ✅ Understand feature behavior visually
- ✅ Spot UI bugs or issues quickly
- ✅ No need to pull and run code for visual review

### For Contributors

- ✅ Clear documentation of changes
- ✅ Easy screenshot generation
- ✅ Consistent PR format
- ✅ Better communication of intent

### For the Project

- ✅ Historical visual record
- ✅ Better onboarding (see UI evolution)
- ✅ Improved PR quality
- ✅ Faster review cycles

---

## Future Enhancements

Possible improvements to this system:

1. **Automatic Screenshot Diffing**: Compare before/after automatically
2. **CI Integration**: Generate screenshots in CI/CD pipeline
3. **Visual Regression Testing**: Detect unintended UI changes
4. **Screenshot Gallery**: Browse all historical screenshots
5. **Annotation Tools**: Mark up screenshots with arrows/notes

---

This example demonstrates the complete workflow and benefits of the new screenshot tooling system.
