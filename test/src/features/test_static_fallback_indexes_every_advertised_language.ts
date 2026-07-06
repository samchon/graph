import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GraphFixtures } from "../internal/GraphFixtures";

export const test_static_fallback_indexes_every_advertised_language = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-languages-"));
  for (const fixture of GraphFixtures.languageFixtures) {
    const dir = path.join(root, fixture.language);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fixture.file), fixture.source);
  }

  const dump = await buildGraphDump({ cwd: root, mode: "static" });
  TestValidator.equals(
    "static fallback language set",
    new Set(dump.languages),
    new Set(GraphFixtures.languageFixtures.map((fixture) => fixture.language)),
  );
  for (const fixture of GraphFixtures.languageFixtures) {
    TestValidator.predicate(
      `${fixture.language} symbol ${fixture.symbol} is indexed`,
      dump.nodes.some((node) => node.language === fixture.language && node.name === fixture.symbol),
    );
    if (fixture.package !== undefined) {
      TestValidator.predicate(
        `${fixture.language} package ${fixture.package} is indexed`,
        dump.nodes.some(
          (node) =>
            node.language === fixture.language &&
            node.kind === "package" &&
            node.name === fixture.package,
        ),
      );
    }
  }
};
