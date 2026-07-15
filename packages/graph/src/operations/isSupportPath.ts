/** True for tests, examples, fixtures, generated output, and build artifacts. */
export function isSupportPath(file: string): boolean {
  return (
    file === "" ||
    file.startsWith("bundled://") ||
    /(^|\/)(node_modules|vendor|site-packages)\//.test(file) ||
    /(^|\/)(test|tests|__tests__|spec|sample|samples|fixture|fixtures|__fixtures__|example|examples)\//.test(
      file,
    ) ||
    /\.(test|spec)\.[^/]+$/.test(file) ||
    /_test\.[^/]+$/.test(file) ||
    /(^|\/)typings\.[cm]?ts$/.test(file) ||
    /\.d\.[cm]?ts$/.test(file) ||
    /(^|\/)(dist|build|coverage|generated|__generated__|gen)\//.test(file)
  );
}
