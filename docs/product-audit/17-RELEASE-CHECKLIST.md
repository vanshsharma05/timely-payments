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
