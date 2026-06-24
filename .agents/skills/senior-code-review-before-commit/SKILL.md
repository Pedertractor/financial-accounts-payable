---
name: senior-code-review-before-commit
description: >-
  Reviews uncommitted changes from a senior developer perspective before commit.
  Inspects git status and diff, compares against project patterns, and reports
  readiness without committing. Use only when the user invokes
  /senior-code-review-before-commit.
disable-model-invocation: true
---

# Senior Code Review Before Commit

Use this workflow only when invoked with `/senior-code-review-before-commit`.

The goal is to inspect the current branch, understand what changed, and review the changes from the perspective of a senior developer, following the existing project patterns.

Do not commit, push, open a Pull Request, merge anything, or assume any Pull Request target branch. This workflow is only for review.

## Workflow

1. Check the current branch.
2. Check the Git status.
3. Inspect all uncommitted changes.
4. Compare the changes with the existing project structure, style, naming, and patterns.
5. Review the code as a senior developer.
6. Report what is correct, what should be improved, and whether the changes look ready to commit.

Use these commands when needed:

```bash
git branch --show-current
git status
git diff
```

Also inspect related files in the project when needed to understand the expected patterns.

## Review Criteria

Check whether the uncommitted changes:

* Follow the existing architecture and project conventions.
* Use consistent naming, formatting, and organization.
* Avoid unnecessary complexity.
* Avoid duplicated logic.
* Handle errors and edge cases properly.
* Keep responsibilities well separated.
* Do not introduce unrelated changes.
* Do not include debug code, temporary comments, console logs, or test-only code unless intentional.
* Are clear, maintainable, and aligned with the rest of the codebase.

## Important Rules

Do not change files automatically during the review.

Do not create a commit unless the user explicitly asks.

Do not push changes unless the user explicitly asks.

Do not open a Pull Request unless the user explicitly asks.

Do not assume the Pull Request target branch.

Only discuss or use a target branch if the user explicitly provides one, for example:

```text
review this branch targeting dev
```

or:

```text
check if these changes are ready for a PR to dev
```

If no target branch is provided, review only the current branch and the uncommitted changes.

## Expected Response

After reviewing, summarize:

1. The current branch name.
2. The files changed.
3. What looks good.
4. What should be fixed or improved before committing.
5. Whether the changes look ready to commit.

If the changes are not ready, explain the required adjustments clearly.

If the changes are ready, say that they look ready to commit, but do not create the commit unless the user explicitly asks.
