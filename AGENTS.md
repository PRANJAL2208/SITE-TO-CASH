# Site-to-Cash Development Rules

- Build only the requested phase. Inspect existing code before editing.
- Preserve working code. Prefer minimal changes; avoid unnecessary dependencies, agents and microservices.
- Core workflow: site instruction → Gemini extraction → contract/BOQ matching → commercial assessment → QS review → evidence pack.
- Never fabricate contract clauses, BOQ rows, rates, quantities, approvals or source references.
- Show evidence sources and missing information. AI recommendations are not confirmed contractual decisions.
- Use deterministic code for calculations.
- Keep API keys in environment variables or Secret Manager. Never commit credentials.
- Test changes and fix regressions before claiming completion.
- Update README.md and STATUS.md at phase boundaries.
- Ask before destructive changes or creating paid cloud resources.
- Keep implementation and responses concise.