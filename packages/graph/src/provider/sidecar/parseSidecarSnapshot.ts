import typia from "typia";

import { ISidecarSnapshot } from "./ISidecarSnapshot";

/** Validate the complete JSON shape before any sidecar fact is considered. */
export function parseSidecarSnapshot(input: unknown): ISidecarSnapshot {
  return typia.assert<ISidecarSnapshot>(input);
}
