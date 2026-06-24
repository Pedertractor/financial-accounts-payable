# Git Branch Workflow — Examples

## Split example

When unrelated changes are mixed, suggest one branch per logical change:

**1. `bugfix/fix-sidebar-overflow`**

Files:

- `src/components/Sidebar.tsx`
- `src/styles/sidebar.css`

Commit: `fix sidebar overflow on smaller screens`

PR: `bugfix/fix-sidebar-overflow → dev`

**2. `refactor/extract-date-utils`**

Files:

- `src/utils/date.ts`

Commit: `refactor date formatting utilities`

PR: `refactor/extract-date-utils → dev`

## Response template — single handling option

```markdown
I found uncommitted changes before starting the new branch workflow.

Current branch:
<branch-name>

Changed files:

- <file>
- <file>

Summary:
<short explanation of what the changes appear to do>

Recommended handling:

<option>

Suggested branch:
<branch-name>

Suggested commit:
<commit message>

Suggested PR:
<branch-name> → dev

I will not switch to dev or create a new branch until you choose how to handle these changes.
```

## Response template — multiple branches (split)

```markdown
I found mixed uncommitted changes before starting the new branch workflow.

Current branch:
<branch-name>

Suggested split:

1. <branch-name>
   Files:
   - <file>
   - <file>
   Commit:
   <commit message>
   PR:
   <branch-name> → dev

2. <branch-name>
   Files:
   - <file>
   - <file>
   Commit:
   <commit message>
   PR:
   <branch-name> → dev

I will not switch to dev or create a new branch until you choose how to handle these changes.
```
