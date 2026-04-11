---
description: Find and fix a specific issue — root cause first, minimal fix
---

1. Understand the issue described by the user.
2. Search the codebase to find the root cause. Check service files first, then routes.
3. Apply the minimal correct fix. Do not refactor beyond scope.
4. Run typecheck and tests to verify the fix.
5. Report: what was wrong, what you changed, files affected, tests passing.
