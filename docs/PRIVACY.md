# Shelf Privacy Policy

_Last updated: 2026-08-20. This policy describes Shelf 1.0.0 and is kept with the public source code for verification._

## Summary

Shelf handles browsing data only when you explicitly save tabs or import a backup. That data is stored locally on your device and is used only to provide Shelf's tab-saving, organization, search, restore, duplicate-cleanup, backup, and recovery features.

Shelf has no server, account, advertising, analytics, telemetry, or tracking. It does not transmit your saved tab data to the developer or any third party.

## Data Shelf handles

Shelf stores the following in Chrome's local extension storage (`chrome.storage.local`):

- the URL and page title of each tab you explicitly save;
- pinned state and saved Chrome tab-group title, color, and collapsed state;
- session names, tab order, creation/update times, and saved times;
- extension settings, including excluded domains and optional tab-limit settings;
- recoverable copies of deleted tabs and sessions in Trash; and
- equivalent data that you explicitly import from a Shelf backup or OneTab export.

Shelf reads the URLs and titles of currently open tabs when required for a user-facing save action or the optional tab-limit feature. It also checks open-tab URLs to locate and deduplicate its own disclosed pinned manager tab. Shelf does not retain unrelated open tabs or build a separate browsing-history log.

## How the data is used

Shelf uses this data solely to provide the features visible in the extension: saving tabs, displaying and searching sessions, restoring tabs and Chrome tab groups, avoiding or removing duplicates, enforcing an optional tab limit, recovering deleted items, and importing or exporting backups.

The data is:

- stored only in local Chrome extension storage on your device;
- not stored in Chrome Sync;
- not transmitted to Shelf's developer, a remote server, or a third party;
- not sold, rented, shared, or transferred;
- not used for advertising, profiling, creditworthiness, or any unrelated purpose; and
- not available for the developer or another human to read because Shelf never receives it.

Shelf requests no host permissions and injects no content scripts. Websites cannot read Shelf's local extension storage. Shelf also restricts its local storage to trusted extension contexts.

## Retention and deletion

Live sessions remain on your device until you delete them or uninstall Shelf. Deleted tabs and sessions normally remain recoverable in Trash for up to 30 days; you can permanently remove them sooner by deleting an item from Trash or emptying Trash.

Chrome deletes Shelf's extension storage when you uninstall the extension. If you want to retain your sessions, export a JSON backup before uninstalling.

## Backups and imports

JSON backups are generated locally and contain saved URLs, titles, organization, and settings in plain text. A backup remains wherever you choose to save it until you delete it. Shelf cannot access or delete exported files after they have been saved outside extension storage.

Imported Shelf or OneTab files are read locally. Valid imported tab data is stored in the same local extension storage described above.

## Favicons

Favicons displayed by Shelf come from Chrome's local favicon cache through the `favicon` permission. Shelf does not contact websites or an external favicon service to retrieve them.

## Permissions

| Permission | Why Shelf needs it |
|---|---|
| `tabs` | Read the URLs, titles, pinned state, and grouping of open tabs being saved; close tabs after a verified save; create and manage restored tabs; and maintain Shelf's disclosed pinned manager tab. |
| `storage` | Store saved sessions, settings, recovery records, and operation journals locally. |
| `unlimitedStorage` | Remove Chrome's normal local-storage quota so large saved-tab libraries and recovery records can remain local. |
| `tabGroups` | Read and recreate Chrome tab-group titles, colors, and collapsed state. |
| `alarms` | Schedule local Trash cleanup, orphan cleanup, and optional tab-limit checks without a persistent background page. |
| `favicon` | Display site icons from Chrome's local favicon cache. |
| `contextMenus` | Provide explicit tab-saving actions in Chrome's context menu. |

## Chrome Web Store Limited Use disclosure

Shelf's use of information received from Chrome APIs complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. Shelf limits use of browsing data to providing or improving its single, user-facing tab-management purpose. Shelf does not transfer this data, use it for advertising, or permit humans to read it.

## Changes

If Shelf's data practices change, this policy and the extension's user-facing disclosures will be updated before or with the release that introduces the change. A feature that transmits saved browsing data will not be enabled silently.

## Contact

Open an issue in the [Shelf repository](https://github.com/mirza-rizvi/shelf/issues). Report security vulnerabilities privately according to the [security policy](../SECURITY.md).
