# Shelf Privacy Policy

_Last updated: 2026-08-19. This policy describes what Shelf actually does in code; the source is open for verification._

## The short version

Shelf stores everything on your device and sends nothing anywhere. There is no server, no account, no analytics, and no tracking of any kind.

## What Shelf stores, and where

When you save tabs, Shelf stores their **URL, page title, pinned state, tab-group name/color/collapsed state, session organization, and the time you saved them** in your browser's local extension storage (`chrome.storage.local`) on your device. Your settings and trash contents are stored the same way.

This data:

- **never leaves your device.** Shelf makes zero network requests. You can verify this: open DevTools → Network on any Shelf page, or read the source — there is no `fetch`, no XHR, no remote script, no CDN.
- is **not synced** to any cloud, including Chrome Sync.
- is **not readable by websites.** Only Shelf (and you) can read it.
- is **deleted by Chrome if you uninstall the extension.** Export a JSON backup first if you want to keep it.

## What Shelf does NOT do

- No analytics, telemetry, crash reporting, or "anonymous usage statistics".
- No accounts, sign-ins, or identifiers.
- No ads, affiliate links, or sponsored content.
- No sharing feature that uploads your tabs to a server (deliberately omitted).
- No selling or transferring of any data to anyone, ever — there is nothing to sell because nothing is collected.

## Favicons

Site icons shown in Shelf come from **Chrome's local favicon cache** via the extension `favicon` permission. Unlike some tab managers, Shelf never contacts Google's favicon service or the websites themselves to fetch icons, so rendering your list leaks nothing.

## Permissions, and why each one exists

| Permission | Why Shelf needs it |
|---|---|
| `tabs` | Read the titles and URLs of your open tabs so they can be saved. This is the permission behind Chrome's "Read your browsing history" warning — it applies to open tabs, and it is the minimum required for any tab manager to function. |
| `storage`, `unlimitedStorage` | Keep your saved tabs and settings on your device without a 10 MB cap, and protect them from storage eviction. |
| `tabGroups` | Preserve your Chrome tab groups' names and colors when saving and restoring. |
| `alarms` | Schedule trash cleanup and tab-limit checks. |
| `favicon` | Show site icons from Chrome's local cache (see above). |
| `contextMenus` | Offer save commands only when you explicitly choose them from Chrome's context menu. |

Shelf requests **no host permissions** and injects **no content scripts** — it cannot read or change anything on any website you visit.

## Data you export

JSON export files are created locally and saved wherever you choose. They are your responsibility to store safely; they contain your saved URLs and titles in plain text.

## Changes

Any future change to this policy will ship with the extension update that implements it, and the changelog will call it out. Features that would transmit data will not be added silently; anything of the sort would be strictly opt-in and off by default.

## Contact

Open an issue in the [Shelf repository](https://github.com/mirza-rizvi/shelf/issues). Security vulnerabilities should be reported privately according to the [security policy](../SECURITY.md).
