export function fileFromUri(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  // Language servers encode the Windows drive-letter colon as `%3A`, which
  // `decodeURI` leaves intact; normalize it before the drive-letter check so
  // the path does not stay malformed and drop every reference edge.
  const withoutScheme = uri
    .slice("file://".length)
    .replace(/^\/([A-Za-z])%3[Aa]/, "/$1:");
  const decoded = decodeURI(withoutScheme);
  if (/^\/[A-Za-z]:/.test(decoded)) return decoded.slice(1).replace(/\//g, "\\");
  return decoded;
}
