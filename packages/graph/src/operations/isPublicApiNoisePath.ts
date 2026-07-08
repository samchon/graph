import { isSupportPath } from "./isSupportPath";

/** True when exported symbols are unlikely to be authored public API. */
export function isPublicApiNoisePath(file: string): boolean {
  return (
    isSupportPath(file) ||
    /(^|\/|\.)typings\.[cm]?ts$/.test(file) ||
    /(^|\/)internal\//.test(file)
  );
}
