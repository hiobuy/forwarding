# Documentation

Start with the repository [README](../README.md). It explains what the project is and how to run it.

| Document | Read it when |
| --- | --- |
| [Local development](development.md) | Installing, project layout, routes, API, and which layer to change |
| [Implementation notes](architecture.md) | How the customer ledger and the HioBuy ledger stay apart, pricing, profit, staff, and security boundaries |
| [Developer Guide](guide.md) | Index of the English guide also rendered at Admin → Developer Guide |
| [Archive](archive/requirements-v1.md) | The early V1 specification and an HTML prototype. Kept for history, not maintained |

The Developer Guide pages live in `docs/getting-started`, `docs/architecture`, `docs/workflows`, `docs/statuses`, `docs/customization`, and `docs/troubleshooting`. The admin only renders files listed in `src/domain/guide.ts`. Add a new page there as well as on disk.

When extending the app, read "Two ledgers" in the implementation notes and "Where to change" in the development notes first. Do not rewrite quote, markup, or profit formulas inside a page.
