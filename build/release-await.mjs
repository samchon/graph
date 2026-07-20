/**
 * Block until the registry actually serves a version it has been told about.
 *
 * npm's publish response and npm's read path are not the same system, and the
 * gap between them is usually short enough to look like nothing. A two-package
 * release is exactly where it stops looking like nothing: the second publish
 * installs the first, and a release that assumes availability fails
 * intermittently, which is the worst of both — too rare to reproduce, too
 * common to ignore.
 */
const packageName = process.env.RELEASE_PACKAGE ?? "";
const version = process.env.RELEASE_VERSION ?? "";
const deadlineMs = Number(process.env.RELEASE_AWAIT_MS ?? 180_000);

if (packageName === "" || version === "") {
  throw new Error(
    "release: RELEASE_PACKAGE and RELEASE_VERSION are both required",
  );
}

const started = Date.now();
const url = `https://registry.npmjs.org/${packageName.replace("/", "%2f")}/${version}`;
for (let attempt = 1; ; attempt++) {
  let served = false;
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    served = response.ok;
  } catch {
    // A transport failure is indistinguishable from "not yet" for this
    // purpose, and both are answered by waiting.
    served = false;
  }
  if (served) {
    process.stdout.write(
      `release: registry serves ${packageName}@${version} after ${String(attempt)} attempt(s)\n`,
    );
    break;
  }
  if (Date.now() - started >= deadlineMs) {
    throw new Error(
      `release: ${packageName}@${version} was published but the registry did not serve it within ${String(deadlineMs)} ms; do not publish anything that depends on it`,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
