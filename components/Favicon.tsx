import { memo, useState } from 'react';
import { faviconUrl, urlInfo } from '../lib/urls';

/**
 * Favicon from Chrome's LOCAL favicon cache (`favicon` permission) — no
 * network request is ever made. Falls back to a letter glyph.
 */
export const Favicon = memo(function Favicon({ url, size = 16 }: { url: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const { host } = urlInfo(url);
  const letter = (host || url).replace(/^www\./, '').charAt(0).toUpperCase() || '?';

  if (failed) {
    return (
      <span className="favicon favicon-fallback" style={{ width: size, height: size }} aria-hidden="true">
        {letter}
      </span>
    );
  }
  return (
    <img
      className="favicon"
      src={faviconUrl(url, size * 2)}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
});
