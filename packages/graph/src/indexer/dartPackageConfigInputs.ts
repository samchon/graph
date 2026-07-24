import path from "node:path";

import { providerInputFiles } from "../provider/providerInputFiles";
import { normalizePath } from "../utils/normalizePath";

/**
 * Generated package-resolution inputs consumed by Dart Analysis Server.
 *
 * `.dart_tool` is intentionally excluded from ordinary source walks. Deriving
 * this exact file from every discovered pubspec keeps the generated dependency
 * graph inside both the provider fingerprint and the coordinator transaction,
 * including while `dart pub get` creates a previously missing file.
 */
export function dartPackageConfigInputs(root: string): string[] {
  const resolved = path.resolve(root);
  return providerInputFiles(resolved, [], ["pubspec.yaml"]).map((pubspec) =>
    normalizePath(
      path.join(path.dirname(pubspec), ".dart_tool", "package_config.json"),
    ),
  );
}
