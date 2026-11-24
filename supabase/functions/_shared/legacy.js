// The old orders (the meeting of 23 Nov phase 9 — «استيراد الداتا القديمة»): every WooCommerce order placed before the day the system
// started syncing (START_DATE in woo-core.js — the owner 19 Nov: «هات الاوردرات من 14 اغسطس») is history imported once by woo-sync
// `legacy_import`. Safwat (phase 9.3 rule 6): «مفيش أي أثر جانبي للأوردرات المستوردة: لا تنبيهات، ولا رد آلي، ولا رسايل واتساب، ولا حركة
// فلوس جديدة» — so every engine that acts on orders (notify's rules and the assistants' facts, cs-auto's events) reads the orders placed
// from LIVE_FROM on only (`.gte('placed_at', LIVE_FROM)`); the screens and the reports read them all.
export const LIVE_FROM = '2026-08-14T00:00:00Z';

/** An order row's placed_at → true when it is an imported old order (before LIVE_FROM). */
export const isLegacy = (placedAt) => { const t = Date.parse(String(placedAt ?? '')); return Number.isFinite(t) && t < Date.parse(LIVE_FROM); };
