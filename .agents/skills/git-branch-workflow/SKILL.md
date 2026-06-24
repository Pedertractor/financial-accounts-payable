---
name: git-branch-workflow
description: >-
  Creates a new branch from the latest dev before making code changes. Enforces
  feature/bugfix/refactor branch naming and PRs targeting dev. Use only when
  the user invokes /git-branch-workflow or explicitly asks to follow the git
  branch workflow.
disable-model-invocation: true
---

# Git Branch Workflow

Use only when invoked with `/git-branch-workflow` or when explicitly requested.

When this skill is invoked, prepare the repository safely before editing any files.

## Goals

- Never make changes directly on `main` or `dev`.
- Never switch branches with uncommitted changes without first analyzing them.
- Help the user organize existing uncommitted work into appropriate branch(es) and PR(s) targeting `dev`.
- Only after the working tree is safe, update `dev` and create the new branch for the requested task.

## Initial inspection

Before any file edits and before switching to `dev`, inspect the current Git state.

```bash
git status --short
git branch --show-current
git diff --stat
```

- **Clean tree** → continue to [Normal branch workflow](#normal-branch-workflow).
- **Uncommitted changes** → stop and perform [Uncommitted-change triage](#uncommitted-change-triage) first.

Do not run `git checkout dev` while uncommitted changes exist unless the user explicitly approves the chosen handling strategy.

## Uncommitted-change triage

When uncommitted changes exist, analyze them before creating the new task branch.

Extend the initial inspection:

```bash
git diff
git diff --cached --stat   # if staged changes exist
git diff --cached          # if staged changes exist
```

List untracked files clearly from `git status --short`.

Summarize:

- current branch
- changed files
- whether changes are staged, unstaged, or untracked
- likely purpose of the changes
- whether the changes appear related or mixed
- whether the current branch name matches the apparent work

Then suggest one handling option below. Use the response templates in [examples.md](examples.md).

### Option 1: Continue on the current branch

Use when:

- the current branch is already a `feature/`, `bugfix/`, or `refactor/` branch
- the branch name matches the existing uncommitted work
- the changes appear related to the same task

Suggest:

```bash
git add <files>
git commit -m "<commit message>"
```

PR target: `current-branch → dev`

After the current work is committed or otherwise handled, continue with the normal branch workflow for the new task if the user still wants to start a new task.

### Option 2: Create a branch for existing uncommitted changes

Use when:

- the user is on `main` or `dev`
- the user is on an unrelated branch
- the current branch name does not match the existing work

Suggest a branch name based on the changes:

```bash
git checkout -b feature/add-invoice-filter
git checkout -b bugfix/fix-sidebar-overflow
git checkout -b refactor/extract-payment-service
```

Then suggest a commit and PR target: `new-branch → dev`

After that work is safely committed, continue with the normal branch workflow for the requested new change.

### Option 3: Split changes into multiple branches

Use when the diff contains unrelated work. Group files by purpose and suggest one branch per logical change.

Do not perform the split automatically unless the user approves.

When splitting, prefer explicit path-based staging:

```bash
git add <file-1> <file-2>
git commit -m "<commit message>"
```

If only part of a file belongs to a commit, ask before using patch staging (`git add -p <file>`). Do not use patch staging without user approval.

See [examples.md](examples.md) for a split example and response template.

### Option 4: Stash temporarily

Use when:

- the existing changes are unrelated to the requested task
- the user does not want to commit them yet
- the user wants to start the new branch now

```bash
git stash push -u -m "git-branch-workflow: pre-workflow stash"
```

After creating the new branch from updated `dev`, ask whether the user wants to apply the stash. Do not apply automatically unless the user explicitly asks (`git stash pop`). If conflicts occur, stop and explain before continuing.

## Normal branch workflow

Only run when the working tree is clean or after the user has approved and completed a handling strategy for uncommitted changes.

```bash
git status --short
git checkout dev
git pull origin dev
git checkout -b feature/descriptive-name   # default
git checkout -b bugfix/descriptive-name    # bug fixes
git checkout -b refactor/descriptive-name  # refactors
```

After creating the new branch, make the requested changes only on that branch.

## Branch naming

Use a short, kebab-case name that describes the change. Use `feature/` by default unless the user clearly asks for a bug fix or refactor.

| Change type       | Prefix      | Example                            |
|-------------------|-------------|------------------------------------|
| Feature (default) | `feature/`  | `feature/add-invoice-filter`       |
| Bug fix           | `bugfix/`   | `bugfix/sidebar-user-menu`         |
| Refactor          | `refactor/` | `refactor/extract-payment-service` |

## Pull request target

The expected PR target is always: `new-branch → dev`

Only move changes from `dev` to `main` when the user explicitly asks for a release or production update.

## If already on a matching branch

If the user is already on a `feature/`, `bugfix/`, or `refactor/` branch for the same task:

- Do not create another branch.
- Confirm that the branch appears to match the requested task.
- Continue working on that branch.
- PR target: `current-branch → dev`

If the current branch does not match the requested task, perform uncommitted-change triage if needed, then create the correct branch from updated `dev`.

## Prohibited actions

Never do any of the following without explicit user approval:

- commit, stash, discard, or reset changes
- clean untracked files
- switch to `dev` with uncommitted changes
- apply a stash
- force push, rebase, or delete a branch

Never run destructive commands unless the user explicitly requested them and the consequences are clear:

```bash
git reset --hard
git clean -fd
git checkout -- <file>
git branch -D <branch>
git push --force
```

## Response templates

When uncommitted changes are found, use the templates in [examples.md](examples.md).

## Checklist

- [ ] Initial inspection (`git status --short`, `git branch --show-current`, `git diff --stat`)
- [ ] If uncommitted changes exist, perform triage
- [ ] If needed, suggest branch(es), commit(s), and PR(s) for existing work
- [ ] Get user approval before committing, stashing, switching, or splitting work
- [ ] Ensure working tree is clean or explicitly handled
- [ ] `git checkout dev` → `git pull origin dev` → `git checkout -b <prefix>/descriptive-name`
- [ ] Make changes on the new branch only
- [ ] PR target: `new-branch → dev`
