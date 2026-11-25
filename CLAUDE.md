# Rules for this repository

- **The repository is public. Nothing of the first customer may be in it.** No customer or company names, handles,
  page/channel/account ids, brand kits, themes, logos or domains, in code, tests, docs, fixtures or commit messages.
  Use neutral fixtures ("Acme Studio"). `scripts/public-release.test.ts` enforces this on every tracked file
  (`pnpm test`, CI); add a pattern there when a new customer name or id appears. Customer-specific material
  (themes, brand kits, real ids) lives in the instance's data directory, never here.
