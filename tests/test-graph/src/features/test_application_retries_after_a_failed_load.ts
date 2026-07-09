import { TestValidator } from "@nestia/e2e";
import { SamchonGraphMemory, SamchonGraphApplication } from "@samchon/graph";

import { GraphFixtures } from "../internal/GraphFixtures";

export const test_application_retries_after_a_failed_load = async () => {
  const memory = SamchonGraphMemory.from(GraphFixtures.createContractFixture().dump);
  let attempt = 0;
  const app = new SamchonGraphApplication(() => {
    attempt += 1;
    // A transient index failure on the first call must not be cached forever.
    if (attempt === 1) return Promise.reject(new Error("transient index failure"));
    return memory;
  });
  const props = {
    question: "load retry",
    draft: { reason: "overview after a failed load.", type: "overview" as const },
    review: "The resident graph must rebuild after a transient failure.",
    request: { type: "overview" as const },
  };

  let failed = false;
  try {
    await app.inspect_code_graph(props);
  } catch {
    failed = true;
  }
  TestValidator.predicate("first load failure propagates", failed);

  const result = await app.inspect_code_graph(props);
  TestValidator.equals("retry rebuilds the graph instead of caching the failure", result.result.type, "overview");
  TestValidator.equals("the graph was rebuilt exactly once after the failure", attempt, 2);
};
