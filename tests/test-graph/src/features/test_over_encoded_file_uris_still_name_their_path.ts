import { TestValidator } from "@nestia/e2e";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { GraphPaths } from "../internal/GraphPaths";

/** `fileFromUri` is an internal boundary, reached through the shipped artifact. */
const importLib = <T>(relative: string): Promise<T> =>
  import(
    pathToFileURL(path.join(GraphPaths.graphPackageRoot, "lib", relative)).href
  ) as Promise<T>;

export const test_over_encoded_file_uris_still_name_their_path = async () => {
  const { fileFromUri } = await importLib<{
    fileFromUri: (uri: string) => string;
  }>("utils/fileFromUri.js");

  // A language server owns the URI encoder on its responses, and some encode
  // more than the reserved characters `fileURLToPath` tolerates — the drive
  // colon AND the separators between the segments. Node rejects that URL
  // outright, so without a fallback the throw would escape the reference lane
  // and drop every edge from the checkout. The path it names is still legible.
  TestValidator.equals(
    "an over-encoded drive path resolves to the drive it names",
    fileFromUri("file:///C%3A%2Frepo%2Fapp.ts"),
    "C:\\repo\\app.ts",
  );

  // The same fallback must not invent a drive where the server named none.
  // `\\server\share` is a real location; reading it as a relative `server/share`
  // would point the graph at a directory below the project root instead.
  TestValidator.equals(
    "an over-encoded UNC path keeps the authority that locates it",
    fileFromUri("file://server/share/a%2Fb.cs"),
    "//server/share/a/b.cs",
  );

  // A host that merely starts with the local one is a real remote host, not the
  // local machine, so its authority is preserved rather than stripped.
  TestValidator.equals(
    "a host that only looks local keeps its authority",
    fileFromUri("file://localhost.localdomain/share/a%2Fb.cs"),
    "//localhost.localdomain/share/a/b.cs",
  );
};
