/**
 * A link to somewhere outside the app.
 *
 * Every href here comes from data rather than from the code: a URL somebody
 * typed, a column of a spreadsheet they uploaded, or a permalink Graph handed
 * back. Validation on the way in is the real defence and it is in place, but it
 * only covers rows written since — a post stored before the CSV columns were
 * checked still renders through here, and so does anything a future write path
 * forgets. Refusing to build an anchor for a scheme that is not http(s) makes
 * that a display quirk rather than a link somebody can be persuaded to click.
 *
 * Unsafe values are shown as plain text, not hidden. The point is that the
 * address stops being clickable, not that the user stops being told what the
 * post says.
 */
export function safeHref(value: string | null | undefined): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : undefined;
  } catch {
    // Not an absolute URL. Every caller here links somewhere external, so a
    // relative path is as wrong as a bad scheme.
    return undefined;
  }
}

export function ExternalLink({
  href,
  className,
  children,
}: {
  href: string | null | undefined;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const safe = safeHref(href);
  if (!safe) return <span className={className}>{children}</span>;

  return (
    <a href={safe} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}
