const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TestValidator } = require("@nestia/e2e");
const { LANGUAGE_SPECS, buildGraphDump, languageOf } = require("../../../lib");
const { languageFixtures } = require("../internal/fixtures.ts");

exports.test_language_registry_lists_advertised_targets = () => {
  TestValidator.equals(
    "advertised language order",
    LANGUAGE_SPECS.map((spec) => spec.language),
    languageFixtures.map((fixture) => fixture.language),
  );
  for (const fixture of languageFixtures) {
    TestValidator.equals(
      `${fixture.language} extension maps to language`,
      languageOf(fixture.file),
      fixture.language,
    );
  }
};

exports.test_static_fallback_indexes_every_advertised_language = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "samchon-graph-languages-"));
  for (const fixture of languageFixtures) {
    const dir = path.join(root, fixture.language);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fixture.file), fixture.source);
  }

  const dump = await buildGraphDump({ cwd: root, mode: "static" });
  TestValidator.equals(
    "static fallback language set",
    new Set(dump.languages),
    new Set(languageFixtures.map((fixture) => fixture.language)),
  );
  for (const fixture of languageFixtures) {
    TestValidator.predicate(
      `${fixture.language} symbol ${fixture.symbol} is indexed`,
      dump.nodes.some(
        (node) =>
          node.language === fixture.language && node.name === fixture.symbol,
      ),
    );
  }
};
