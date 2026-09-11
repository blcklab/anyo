# Contributing

Install dependencies and run the checks from the project root:

```bash
npm ci
npm run check
```

Use `npm test` for the build and test suite, or `npm run test:run` after a build. See [tests](tests/README.md) for details.

## Working on Anyo

Keep the world compiler independent of rendering engines. Add renderer-specific code in adapters and optional behavior in plugins or systems. Core modules should keep working without mandatory runtime dependencies or a browser DOM.

World JSON is data. Register executable behavior in application code, and keep renderer handles and other live objects out of serialized documents.

Add regression tests for behavior changes, especially geometry, validation, collision, updates, and lifecycle. Update the public docs when an API or its behavior changes.

## Pull requests

Explain the problem, what changes for the caller, and how you tested it. Include a small before/after example when it makes the change easier to review. Leave generated `dist` files out of the commit.
