# Code Review Checklist

Use this checklist before writing the final review.

## Correctness

- Does the change preserve existing behavior for unchanged inputs?
- Are new branches, error paths, and edge cases covered?
- Are async operations awaited and failures handled?

## Tests

- Are there focused tests for the changed behavior?
- Do tests cover regression-prone paths?
- Are fixtures realistic enough to catch integration mistakes?

## Maintainability

- Is the change scoped to the requested behavior?
- Are names, module boundaries, and public APIs consistent with the existing codebase?
- Is any new abstraction justified by repeated complexity?

## Security

- Does the change expose new filesystem, network, script, or credential access?
- Are user-controlled paths and commands validated?
- Are logs free of secrets and sensitive payloads?
