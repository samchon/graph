import { TestValidator } from "@nestia/e2e";

import { ContractParity } from "../internal/ContractParity";

/**
 * A gate that cannot fail is decoration, so this exercises the failures the
 * parity gate exists to catch.
 *
 * Each case bends the reference one property away from what the product
 * actually declares and proves the comparison notices. They run against
 * `expected` rather than against edited source on disk, because the assertion
 * under test is the comparison itself: whatever reaches it must survive to the
 * far side, unexplained, and not match.
 */
export const test_application_contract_parity_fails_closed_on_drift = () => {
  const canonical = ContractParity.canonical();
  const application: string = canonical.contracts.Application.structure;

  const drifted = (mutate: (text: string) => string): string =>
    ContractParity.expected("Application", mutate(application), "structure");

  TestValidator.notEquals(
    "a renamed request field breaks parity",
    drifted((text) => text.replace("question: string;", "prompt: string;")),
    ContractParity.actual("Application"),
  );

  TestValidator.notEquals(
    "a field that stops being required breaks parity",
    drifted((text) => text.replace("review: string;", "review?: string;")),
    ContractParity.actual("Application"),
  );

  TestValidator.notEquals(
    "a dropped request union member breaks parity",
    drifted((text) =>
      text.replace("| ITtscGraphTour.IRequest\n", ""),
    ),
    ContractParity.actual("Application"),
  );

  TestValidator.notEquals(
    "a dropped result union member breaks parity",
    drifted((text) => text.replace("| ITtscGraphOverview\n", "")),
    ContractParity.actual("Application"),
  );

  TestValidator.notEquals(
    "an added output field breaks parity",
    drifted((text) =>
      text.replace("audit: string;", "audit: string;\nprovider: string;"),
    ),
    ContractParity.actual("Application"),
  );

  // The vocabulary is where the multi-language extensions live, so its rules are
  // the ones most likely to be loosened by someone in a hurry. An extension that
  // grows past what was reviewed has to fail exactly like a rename does. The
  // kind is added away from `tests`, which is the anchor the reviewed extension
  // rule keys on, so the rule still applies and the drift reaches the comparison
  // rather than being caught earlier as a stale rule.
  TestValidator.notEquals(
    "an unreviewed edge kind breaks parity",
    ContractParity.expected(
      "EdgeKind",
      canonical.contracts.EdgeKind.structure.replace(
        '| "contains"',
        '| "contains"\n| "invents"',
      ),
      "structure",
    ),
    ContractParity.actual("EdgeKind", "structure"),
  );

  // A reviewed rule names one exact shape. If the reference moves out from under
  // it, the honest outcome is a stopped gate — not a silently re-derived
  // contract that no review ever covered.
  TestValidator.error(
    "a reviewed rule that no longer matches the reference stops the gate",
    () =>
      ContractParity.expected(
        "Node",
        canonical.contracts.Node.structure.replace(
          "kind: TtscGraphNodeKind;",
          "kind: TtscGraphNodeKind | undefined;",
        ),
        "structure",
      ),
  );

  // The prose layer exists for exactly the drift the structure layer is blind
  // to. A `@default` bump changes behaviour while leaving the shape untouched —
  // this is the ttsc `details` change that motivated the layer — and a reworded
  // instruction changes what a caller is told. Both must fail here, and both are
  // invisible to a comment-stripped diff.
  const details: string = canonical.contracts.Details.prose;
  const driftedProse = (mutate: (text: string) => string): string =>
    ContractParity.expected("Details", mutate(details), "prose");

  TestValidator.notEquals(
    "a changed @default breaks prose parity though the shape is identical",
    driftedProse((text) => text.replace(/@default\s+\d+/, "@default 999")),
    ContractParity.actual("Details", "prose"),
  );

  TestValidator.notEquals(
    "a reworded instruction breaks prose parity",
    driftedProse((text) =>
      text.replace(
        "when `neighbors:true`",
        "when `neighbors:true` and the moon is full",
      ),
    ),
    ContractParity.actual("Details", "prose"),
  );

  // Wrapping is not a contract. The same sentence broken at a different word
  // must still reproduce, or every prose comparison would drown in formatter
  // noise and the gate would be unusable.
  TestValidator.equals(
    "re-wrapping a sentence does not break prose parity",
    ContractParity.normalize(
      "/**\n * one two three\n * four five\n */",
      "prose",
    ),
    ContractParity.normalize("/**\n * one two\n * three four five\n */", "prose"),
  );
};
