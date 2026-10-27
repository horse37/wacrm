# Handoff — PostgreSQL conversation/contact lookup for WhatsApp send

- Task `20261021-021057-20b3`, H-DATA-003 phase 03, status `in_progress`.
- The preceding `POST /api/whatsapp/send` account guard slice is independently approved; see `../20261021-014944-3f34/review-gpt6-luna-final-20261021.md`.
- Migrate only the account-scoped conversation/contact read. Keep all other queries and writes in the route unchanged.
- Test with synthetic fixtures; never call Meta/WhatsApp services.
- Use only disposable PostgreSQL in Docker Desktop if SQL/repository changes require DB proof. Never use Supabase, VPS, production, real data or credentials.
- Preserve local changes. No reset, restore, clean, rebase, branch switch, commit, push or deploy. Stop at 09:00 BRT on 2026-10-22.

## Next action

Slice completed after internal and independent GPT-6 Luna `APPROVE`, zero findings and zero caveats. Follow-up is task `20261021-025715-4b73` for the separate reply-target read; approval remains limited to the conversation/contact lookup.