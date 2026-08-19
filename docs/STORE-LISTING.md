# Chrome Web Store Listing — Shelf 1.0.0

This file is the paste-ready source of truth for Shelf's first manual Chrome Web Store submission.

## Store listing

**Name**

Shelf — Privacy-First Tab Manager

**Summary**

Save open tabs to a private local list and restore them later. No accounts, no cloud, no tracking — data never leaves this device.

**Category and language**

- Category: Productivity
- Language: English

**Description**

Too many tabs? Put them on the Shelf.

Shelf saves the tabs you choose into a simple local list. Restore one tab or a complete session whenever you need it.

PRIVATE BY DESIGN

Saved URLs, titles, tab metadata, settings, and Trash stay in Chrome's local extension storage on your device. Shelf has no account, cloud service, analytics, ads, or telemetry and makes no external requests. Favicons come from Chrome's local cache.

RELIABLE SAVING AND RECOVERY

Shelf writes and verifies saved data before closing a tab. Deleted tabs and sessions remain recoverable in local Trash for 30 days. Export a versioned JSON backup whenever you want.

ESSENTIAL TAB MANAGEMENT

Save one tab, highlighted tabs, a Chrome tab group, one window, or all windows. Search saved sessions, restore individual tabs or complete sessions, preserve Chrome tab groups, remove duplicate URLs, and import an existing OneTab export.

LIGHTWEIGHT RESTORE

Complete sessions restore with tabs unloaded to minimize memory use until opened. Restoring keeps the saved copy by default.

OPTIONAL TAB LIMIT

If enabled, Shelf moves the oldest eligible overflow tabs into a saved session. It excludes the active tab, pinned tabs, tabs playing audio, and tabs that are already unloaded.

PINNED MANAGER TAB

Shelf keeps one small manager tab pinned at the left of the tab strip so saved tabs stay one click away. It re-pins itself and returns if closed, but closing its containing window still closes that window normally.

## URLs

- Website: https://github.com/mirza-rizvi/shelf
- Support: https://github.com/mirza-rizvi/shelf/issues
- Privacy policy: https://github.com/mirza-rizvi/shelf/blob/main/docs/PRIVACY.md

## Privacy dashboard

**Single purpose**

Shelf saves tabs selected by the user into a private local list and restores them later. Its organization, search, duplicate cleanup, recovery, backup, and optional tab-limit features directly support that tab-management purpose.

**Permission justifications**

| Permission | Dashboard justification |
|---|---|
| `tabs` | Reads the URLs, titles, pinned state, and grouping of tabs the user saves; closes tabs after a verified save; restores saved tabs; and maintains the disclosed pinned Shelf manager tab. |
| `storage` | Stores saved sessions, settings, Trash records, and crash-recovery journals locally on the user's device. |
| `unlimitedStorage` | Removes Chrome's normal local-storage quota so large saved-tab libraries and recovery records can remain on the user's device. |
| `tabGroups` | Reads and recreates Chrome tab-group titles, colors, and collapsed state when saving and restoring sessions. |
| `alarms` | Schedules local Trash cleanup, orphan cleanup, and optional tab-limit checks in the Manifest V3 service worker. |
| `favicon` | Displays site icons from Chrome's local favicon cache without contacting a website or favicon service. |
| `contextMenus` | Adds explicit tab-saving actions to Chrome's context menu. |

**Data-use answers**

- Data category: Web history — saved tab URLs and titles.
- Handling: processed and stored locally on the user's device; never transmitted to the developer or a third party.
- Remote code: No.
- Certify that data is not sold or transferred, is not used for an unrelated purpose, is not used for creditworthiness or lending, and complies with the Limited Use requirements.
- Confirm that these answers exactly match `docs/PRIVACY.md` before every submission.

## Assets

Upload:

- `public/icon/128.png` as the 128×128 store icon;
- `store-assets/1-manager-light.png` at 1280×800;
- `store-assets/2-manager-dark.png` at 1280×800;
- `store-assets/3-settings.png` at 1280×800; and
- `store-assets/promo-tile-440x280.png` as the 440×280 small promo tile.

Regenerate screenshots after any visible UI change:

```bash
npm run build
node scripts/screenshots.mjs
```

## Release package

Run the complete release gate:

```bash
npm ci
npm run release:check
```

Upload `dist/shelf-1.0.0-chrome.zip`. The release verifier checks the manifest, permissions, CSP, assets, bundled code, ZIP layout, and checksum. Chrome requires `manifest.json` at the root of the ZIP.

## Manual first-submission checklist

1. Register at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), accept the agreement, and pay the one-time registration fee.
2. Complete the developer profile, verify the contact email, and enable two-step verification.
3. Run `npm ci` and `npm run release:check` from a clean checkout.
4. Load `dist/chrome-mv3` unpacked in Chrome 121 or newer and complete `docs/TESTING.md`.
5. Create a new dashboard item and upload `dist/shelf-1.0.0-chrome.zip`.
6. Paste the listing text, single-purpose statement, permission justifications, data-use answers, and exact URLs from this document.
7. Upload the icon, three screenshots, and promo tile listed above.
8. Set distribution to Public, all regions, free, and no in-app purchases.
9. Review the dashboard preview for accuracy and submit it for review. Review timing varies; check the dashboard for status or requested changes.
10. After approval, install the public store build and repeat the core smoke test.

Chrome requires each later uploaded package version to be greater than the previous version. For updates, change `package.json` first and rerun `npm run release:check`.
