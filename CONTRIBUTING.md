# Contributing to Shelf

Thanks for helping improve Shelf. Privacy, data safety, speed, and simplicity take priority over feature count.

## Development setup

Use Node.js 20 or newer.

```bash
npm ci
npm run dev
```

Load `dist/chrome-mv3` from `chrome://extensions` with Developer mode enabled.

Before submitting a change, run:

```bash
npm run check
```

## Contribution guidelines

- Keep all saved browsing data local unless a future feature is explicitly opt-in and locally encrypted.
- Do not add analytics, telemetry, remote scripts, hosted assets, content scripts, or host permissions.
- Keep browser APIs behind the service/storage layer rather than calling them directly from UI components.
- Preserve the write-verify-close invariant: a failed save must never close the source tabs.
- Treat imported files and saved titles/URLs as hostile input.
- Add tests for storage, migrations, destructive actions, restore behavior, and import validation.
- Explain any new dependency or permission in the pull request and update the privacy and store documentation when applicable.

Bug reports and focused feature proposals are welcome through [GitHub Issues](https://github.com/mirza-rizvi/shelf/issues).
