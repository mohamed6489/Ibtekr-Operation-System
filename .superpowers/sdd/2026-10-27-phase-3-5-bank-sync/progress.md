# Phase 3.5 — the bank account two-way with Dokan, with a confirmation; the e-mail always read

Plan: `docs/superpowers/plans/2026-10-27-phase-3-5-bank-sync.md` (decisions 1–9).
Branch: main-gha10e; `main` after the staging live sequence (decision 8).
Owner (27 Oct): bank data «comes wrong or not at all» (screenshot of Dokan «Payment Options» — values not copied anywhere); answers: two-way like the store data, a confirmation button of its own for a bank change, every Dokan field. Mid-phase: the maker's e-mail never arrives (it is the WordPress e-mail, the one typed in «إضافة مبتكر») → decision 9.
In-session, sequential, no agents. Cost at the start ≈ $891.

## Facts
- probe_store (shapes only) on 44 / 2025 / 2374 with the application password: payment.bank = ac_name, ac_number, ac_type, bank_name, bank_addr, routing_number, iban, swift; payment.paypal = { "0", email }.
- vendor_bank on staging: 2 rows, both typed by hand, iban holding digits only (an account number) — the "wrong" data; nothing came from the site (by the 3.3 rule).

## Progress (controller)
- **DB (1e500c2):** 0017_bank_sync + rls_bank_sync; rls_vendors column list. db:test 18 files ok.
- **Sync (d96eac6):** woo-core BANK_KEYS / bankDigest / mapStore.bank / per-field first run / toDokanStore bank; woo-write loadBanks / writeSiteBank / digests; woo-sync authorize + push_vendor bank. Node + Deno tests.
- **Front end:** adapter (columns, shape, cleanBank / bankRow, setBank pushes ['bank'] for a synced maker, canPush bank rule, reveal accountNumber); block 06 validateBank (account number / IBAN apart, SWIFT, routing), BANK_ACCOUNT_TYPES, SYNC_FIELD_LABELS.bank; block 28 bankFields (every field), bankForm → confirmBank («أيوه، غيّر الحساب البنكي» / «رجوع للتعديل»), drawer rows (account number masked), import keys (lock run); mock (columns, push rule, RPC rule). 
- **E-mail (decision 9):** mapStore reads `email` whatever show_email says; tests updated.
- Tests: unit 255, Deno 98, e2e 134, db:test 18. semgrep blocked in this sandbox (CI's gate).
