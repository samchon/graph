/**
 * True for source files whose declarations are tests or test helpers.
 *
 * The suffix rules are anchored to the end of the filename, the way the
 * reference's `\.(test|spec)\.[cm]?tsx?$` is. Only the extension itself is open,
 * because the extension is the part that is language-specific — the *shape*
 * (`name.test.ext`, `name_test.ext`) is not, and unanchoring it turns a
 * directory called `my.spec.fixtures/` into a test path and quietly drops
 * everything under it out of the tour, the centrality, and the reference
 * ranking.
 */
export function isTestPath(file: string): boolean {
  return (
    /(^|\/)(test|tests|__tests__|spec)\//.test(file) ||
    // Gradle/Kotlin-Multiplatform source sets name test roots
    // `<platform>Test` (commonTest, jvmTest, androidTest, iosTest, ...)
    // rather than a bare `test` segment.
    /(^|\/)\w*Test\//.test(file) ||
    /\.(test|spec)\.[^/]+$/.test(file) ||
    /_test\.[^/]+$/.test(file)
  );
}
