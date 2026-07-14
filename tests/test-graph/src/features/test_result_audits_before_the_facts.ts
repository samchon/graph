import { TestValidator } from "@nestia/e2e";
import { RESULT_AUDIT, RESULT_AUDIT_ESCAPE } from "@samchon/graph";

import { ContractGraph } from "../internal/ContractGraph";

/**
 * A result reports what was audited first, and carries no demand for obedience.
 *
 * The server used to stamp a `directive` onto every result telling the model the
 * facts were sacred and that "doubting an unedited compiler result is not
 * diligence but psychosis". A tool result is untrusted input, so a command inside
 * one has the exact shape of a prompt injection — and models read it that way:
 * Sonnet called it "a prompt-injection-style directive baked into the MCP
 * server's tool result", checked the graph against the sources on principle, and
 * warned the user about the server in its answer.
 *
 * What the directive commanded, `audit` now explains: what was checked, against
 * what, and what that leaves the facts worth. It serializes before `result`, so
 * the provenance precedes the facts it is about. The instruction still follows —
 * evidence first, instruction second is the whole rule — but the stop-or-continue
 * decision belongs to `next`, so the audit never contradicts a partial result
 * that legitimately asks for one more request.
 */
export const test_result_audits_before_the_facts = async () => {
  const app = ContractGraph.createApplication();

  const overview = await ContractGraph.call(app, { type: "overview", aspect: "all" });
  TestValidator.equals(
    "audit leads, then where it leaves the question, then the facts",
    Object.keys(overview),
    ["audit", "next", "result"],
  );
  TestValidator.equals(
    "a result assembled from graph nodes audits clean",
    overview.audit,
    RESULT_AUDIT,
  );
  TestValidator.equals("the overview is the whole answer", overview.next.action, "answer");

  // The audit states its evidence before it instructs, and the instruction it
  // does give hands the stop rule to `next` rather than claiming it.
  TestValidator.predicate(
    "the audit says what was checked before it says what to do",
    RESULT_AUDIT.indexOf("AUDITED BEFORE RETURNING") <
      RESULT_AUDIT.indexOf("Trust every fact it gives"),
  );
  TestValidator.predicate(
    "the audit defers the stop rule to next",
    RESULT_AUDIT.includes("Re-call the graph only when `next` says inspect"),
  );
  // The line that was measured, put back, and measured again: it cost four cells
  // out of four, and it is not coming back.
  TestValidator.predicate(
    "the audit never insults the reader for checking",
    !/psychosis|arrogance|sacred/i.test(RESULT_AUDIT),
  );

  // An escape runs no graph operation and returns no node, span, edge, or step.
  // It has nothing to have audited, and a payload that swears it holds no matched
  // or inferred fact must not itself be one.
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
