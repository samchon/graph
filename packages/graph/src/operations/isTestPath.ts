export function isTestPath(file: string): boolean {
  return (
    /(^|\/)(test|tests|__tests__|spec)\//.test(file) ||
    // Gradle/Kotlin-Multiplatform source sets name test roots
    // `<platform>Test` (commonTest, jvmTest, androidTest, iosTest, ...)
    // rather than a bare `test` segment.
    /(^|\/)\w*Test\//.test(file) ||
    /\.(test|spec)\./.test(file) ||
    /_test\./.test(file)
  );
}
