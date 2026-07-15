import { TestValidator } from "@nestia/e2e";
import { RESULT_AUDIT, RESULT_AUDIT_ESCAPE } from "@samchon/graph";

import { ContractGraph } from "../internal/ContractGraph";

/**
 * A result reports what was audited first and preserves the reference contract:
 * evidence, the instruction to trust that evidence, and the `next` stop rule.
 */
export const test_result_audits_before_the_facts = async () => {
  const app = ContractGraph.createApplication();

  const overview = await ContractGraph.call(app, { type: "overview", aspect: "all" });
  TestValidator.equals(
    "audit leads, then where it leaves the question, then the facts",
    Object.keys(overview),
    ["audit", "next", "result"],
  );
  TestValidator.equals("the overview is the whole answer", overview.next.action, "answer");

  // The contract fixture is a static parse, and the audit says so. It does not
  // claim a language server resolved anything, because none did.
  TestValidator.equals(
    "a result audits against the index that actually built it",
    overview.audit,
    RESULT_AUDIT("static"),
  );
  TestValidator.predicate(
    "and a parsed index never claims a compiler resolved it",
    !/compiler|type-checked|checker/i.test(RESULT_AUDIT("static")),
  );
  TestValidator.predicate(
    "a language-server index says so, because there really was one",
    RESULT_AUDIT("lsp").includes(
      "the language server's own program index of this project",
    ),
  );
  TestValidator.predicate(
    "and a hybrid index claims neither of the two for all of it",
    RESULT_AUDIT("hybrid").includes("the languages one is installed for"),
  );

  // The audit states its evidence before it instructs, and the instruction it
  // does give hands the stop rule to `next` rather than claiming it.
  for (const lane of ["lsp", "static", "hybrid"] as const) {
    const audit = RESULT_AUDIT(lane);
    TestValidator.predicate(
      `the ${lane} audit says what was checked before it says what to do`,
      audit.indexOf("AUDITED BEFORE RETURNING") <
        audit.indexOf("Trust every fact it gives"),
    );
    TestValidator.predicate(
      `the ${lane} audit defers the stop rule to next`,
      audit.includes("Re-call the graph only when `next` says inspect"),
    );
    TestValidator.predicate(
      `the ${lane} audit carries the reference certainty claim`,
      audit.includes("100%, NOT ONE ERROR"),
    );
  }

  // An escape runs no graph operation and returns no node, span, edge, or step.
  // It has nothing to have audited, and a payload that swears it holds no ranked
  // or guessed-at fact must not itself be one.
  const escape = await ContractGraph.call(app, {
    type: "escape",
    reason: "The next evidence is a function's body, which the graph does not carry.",
    nextStep: "Read the returned sourceSpan.",
  });
  TestValidator.equals(
    "an escape claims no graph facts",
    escape.audit,
    RESULT_AUDIT_ESCAPE,
  );
  TestValidator.equals("an escape leaves the graph", escape.next.action, "outside");
  TestValidator.equals("an escape marks itself skipped", (escape.result as { skipped?: boolean }).skipped, true);
  TestValidator.equals(
    "an escape carries the caller's next step",
    (escape.result as { nextStep?: string }).nextStep,
    "Read the returned sourceSpan.",
  );

  // `next` may carry only a fact about the request that was just answered. A
  // handle the graph holds no node for is one such fact; so is a lookup that
  // matched nothing, and a first-pass handle list that is partial by design.
  const unknown = await ContractGraph.call(app, {
    type: "details",
    handles: ["NoSuchSymbolAnywhere"],
  });
  TestValidator.equals(
    "a handle that resolves to nothing sends the caller outside",
    unknown.next.action,
    "outside",
  );

  const empty = await ContractGraph.call(app, { type: "lookup", query: "!!!" });
  TestValidator.equals(
    "a query with no searchable terms asks the caller to restate it",
    empty.next.action,
    "clarify",
  );

  const entrypoints = await ContractGraph.call(app, {
    type: "entrypoints",
    query: "Root.Service.run",
  });
  TestValidator.equals(
    "a first-pass handle list is partial by design",
    entrypoints.next.action,
    "inspect",
  );
  TestValidator.equals(
    "and it names the one request that completes the answer",
    entrypoints.next.request,
    "trace",
  );
};
