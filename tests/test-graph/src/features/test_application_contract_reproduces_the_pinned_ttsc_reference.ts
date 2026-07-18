import { TestValidator } from "@nestia/e2e";

import { ContractParity } from "../internal/ContractParity";

/**
 * The product is a multi-language reproduction of `ITtscGraphApplication`, and
 * this is where that claim stops being prose.
 *
 * Applying the reviewed rules to the pinned reference must reproduce this
 * product's contract exactly, contract by contract, at both fidelities. An exact
 * match is the whole assertion: every difference between the two is one somebody
 * reviewed and wrote down.
 *
 * The two layers catch different drift. `structure` — comment-stripped — fails
 * on a renamed field, a dropped union member, a requiredness change, a re-nested
 * result, or an unenumerated extension. `prose` — comments included — fails on a
 * reworded instruction a caller reads or a silent `@default` bump that changes
 * behaviour, the drift a shape diff cannot see. The reference's `details`
 * default going from one to two, or its member cap becoming unlimited, is
 * invisible to `structure` and caught only here.
 */
export const test_application_contract_reproduces_the_pinned_ttsc_reference =
  () => {
    const canonical = ContractParity.canonical();

    TestValidator.equals(
      "the canonical fixture covers exactly the contracts under parity",
      Object.keys(canonical.contracts).sort(),
      Object.keys(ContractParity.CONTRACTS).sort(),
    );

    for (const contract of Object.keys(ContractParity.CONTRACTS))
      for (const layer of ["structure", "prose"] as const)
        TestValidator.equals(
          `${contract} reproduces the reference ${layer} under its reviewed rules`,
          ContractParity.expected(
            contract,
            canonical.contracts[contract]![layer],
            layer,
          ),
          ContractParity.actual(contract, layer),
        );
  };
