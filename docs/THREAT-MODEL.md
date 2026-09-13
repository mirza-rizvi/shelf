# Shelf Threat Model

## Assets

1. The user's saved tab data (URLs + titles = browsing-history-grade information).
2. The user's live open tabs (Shelf can enumerate and close them).
3. The user's trust in the "zero egress" claim.

## Trust boundaries

- Shelf ⟷ network: **no boundary exists** — Shelf makes no network requests. This eliminates the entire remote attack surface (no server to breach, no TLS to misconfigure, no API to abuse).
- Shelf ⟷ web pages: no content scripts, no host permissions → no page can talk to Shelf, and Shelf cannot touch pages.
- Shelf ⟷ other extensions: extension storage is origin-isolated by Chrome.
- Shelf ⟷ user-supplied files: **the one real input boundary** — import files.

## Threats and mitigations

### T1 — Hostile import file (the primary attack surface)
A crafted JSON/text file could attempt prototype pollution, type confusion, storage exhaustion, or smuggling executable URLs (`javascript:`, `data:`).

Mitigations (`lib/importExport/importJson.ts`, tested against hostile fixtures):
- Field-by-field copy onto fresh objects (nothing spread/merged from input); `__proto__`/`constructor` payloads inert.
- Every field type-checked; unknown fields dropped; strings clamped (title ≤ 2 KB, URL ≤ 8 KB, name ≤ 512 B).
- ALL ids regenerated — imported ids never touch storage keys.
- Dangerous URL schemes rejected at import AND again at restore time (defense in depth); restore uses a scheme allowlist.
- Per-entry skip with a report; a malformed entry cannot abort or corrupt the batch.

### T2 — Rendering saved titles/URLs (XSS)
Titles are attacker-influenced (page-controlled). Mitigation: React text interpolation everywhere; no `dangerouslySetInnerHTML`, no `innerHTML`; MV3 CSP (`script-src 'self'`) blocks inline script as a second layer.

### T3 — Data loss (availability threat — the one users actually suffer)
Causes seen in the wild: crash mid-write, corrupted store, bad migration, accidental deletion, rage-uninstall.
Mitigations: write-verify-close invariant + operation journal (crash ⇒ duplicate, never loss); trash with retention; resumable migrations; downgrade refusal; JSON export. Residual risk: **uninstall deletes storage** (Chrome platform rule) — mitigated only by user-held exports; stated plainly in the privacy policy.

### T4 — Supply chain / ownership transfer (the Great Suspender scenario)
An update could silently add exfiltration. Mitigations available to users and reviewers:
- Zero-egress claim is falsifiable in DevTools in ten seconds.
- Open, auditable source; a small dependency tree with three declared runtime packages and a reproducible npm lockfile.
- No remote code (MV3-enforced) and no code paths that fetch anything.
Residual risk: a malicious future maintainer. Policy: any ownership change will be disclosed; the honest mitigation for users is Chrome's own update review plus the public source.

### T5 — Local adversaries
Another process reading the Chrome profile can read Shelf's storage — identical exposure to browser history itself. Full-disk encryption is the correct control; encrypting inside the extension would only offer obfuscation (the key would live beside the data). Documented, not defended.

### T6 — Destructive-action abuse (self-inflicted)
Closing tabs bypasses `beforeunload`; unsaved page state can be lost. Mitigations: the tab limit defaults OFF; active/pinned/audible tabs never auto-moved; everything undoable via trash.

### T7 — Denial of service via tab-limit feedback loops
A restore reopening tabs could re-trigger auto-save. Mitigations: startup grace period, debounce, latch, Shelf's own pages excluded from counting/saving, auto modes act only on eligible excess.

## Chrome Web Store data disclosure (accurate)

- Collects: **web history (tab URLs/titles) — stored locally only, never transmitted.**
- Certifies: not sold; not used outside core functionality; not used for creditworthiness.
- No remote code. Single purpose: saving and restoring browser tabs.
