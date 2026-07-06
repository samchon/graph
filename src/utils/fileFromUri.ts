export function fileFromUri(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  const decoded = decodeURI(uri.slice("file://".length));
  if (/^\/[A-Za-z]:/.test(decoded)) return decoded.slice(1).replace(/\//g, "\\");
  return decoded;
}
