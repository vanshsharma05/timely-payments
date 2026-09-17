# 17 — RELEASE CHECKLIST

Status: skeleton — Phase 19. Nothing below is ticked until verified.

- [ ] `npm run build` succeeds (typecheck + web + server bundle)
- [ ] Browser suites green (`scripts/tests/*` once brought into the repo)
- [ ] Unit tests green (once added)
- [ ] Lint (once added)
- [ ] Critical journeys pass on laptop and phone: sign-in, Today, follow-up save, WhatsApp link, book filters/export, cheque lifecycle, balance sync + reconciliation, live stock, team login create/delete, daily email test send
- [ ] Authorization: each role sees and can do only what `can()` and RLS allow (spot-checked with a throwaway login)
- [ ] `.env.example` complete; no secrets in the repo (`git grep` for keys)
- [ ] `npm audit --omit=dev` clean or accepted with reason
- [ ] Vercel function limits and cron verified in production
- [ ] Rollback: previous production deployment identified (`npx vercel ls --prod`) and promotable
- [ ] ARCHITECTURE.md and README current

## Deploy and verify — the sequence as run on 2026-09-17 (dpl_8NB7JLzJoSuCKsecBwz7WiycZBgJ)

1. Clean tree; `git log --oneline origin/main..restore-and-fix` lists exactly the commits meant to go out; no `supabase/`, `api/`, `package*`, `bun.lock` or Vercel-config changes unless intended. **If `supabase/*.sql` changed, run the changed file in the project's SQL editor BEFORE deploying the client** (the fresh start calls `public.reset_book`, which must exist; until it does the button fails closed).
2. Gate: `npx tsc --noEmit`, `npx vitest run` (expect the count in 00-MASTER-STATUS.md), `npm run build`, `npm run check:classes`, `npm run check:empty`.
3. `git push origin restore-and-fix` · `git push origin restore-and-fix:main` · `git branch -f main restore-and-fix`.
4. `npx vercel deploy --prod --yes` (retry once on "Not authorized"); note the `dpl_…` id from `npx vercel inspect <url>`; `npx vercel ls --prod` shows it as the current production deployment.
5. Prove the live code is the commit: fetch `/` and every `/assets/*.js` it references, `cmp` each against `dist/assets/*` from the local `npm run build` of the same clean tree — chunk *names* differ (the hash includes the path), the *bytes* must not.
6. Read-only smoke against the live URL with request interception aborting every non-GET `/rest/v1/*` and mutating `/api/*` call: sign-in, book, search, follow-up dialog, edit dialog, Reports, PDC, live stock, no page errors.
7. Probes against the live URL (`PROBE_BASE=https://timely-payment.vercel.app node scripts/tests/write-payload-probe.cjs …` and `status-contract-probe.cjs …`): compare with the results recorded in 11 / 16. Then re-read the probe accounts' `updated_at` — unchanged.
8. Never: the reset, `crm-test.cjs` (creates a login) or any suite that writes, against production. Rollback: the previous production deployment (`npx vercel ls --prod`) is promotable with `npx vercel promote <url>`.
