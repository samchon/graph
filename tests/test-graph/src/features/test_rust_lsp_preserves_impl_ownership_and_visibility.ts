import { TestValidator } from "@nestia/e2e";
import { buildGraphDump } from "@samchon/graph";

import { GraphFixtures } from "../internal/GraphFixtures";
import { GraphPaths } from "../internal/GraphPaths";

export const test_rust_lsp_preserves_impl_ownership_and_visibility = async () => {
  const root = GraphFixtures.createRustImplFixture();
  const lspDump = await buildGraphDump({
    cwd: root,
    mode: "lsp",
    languages: ["rust"],
    server: process.execPath,
    serverArgs: [GraphPaths.fakeLspServer, "--rust-impls"],
    lspReferenceLimit: 0,
  });
  const staticDump = await buildGraphDump({
    cwd: root,
    mode: "static",
    languages: ["rust"],
  });

  const validate = (
    lane: string,
    dump: Awaited<ReturnType<typeof buildGraphDump>>,
  ): void => {
    const runtime = dump.nodes.find((node) => node.name === "Runtime");
    const handle = dump.nodes.find((node) => node.name === "Handle");
    const runtimeSpawn = dump.nodes.find(
      (node) => node.qualifiedName === "Runtime.spawn",
    );
    const runtimeBlockOn = dump.nodes.find(
      (node) => node.qualifiedName === "Runtime.block_on",
    );
    const handleSpawn = dump.nodes.find(
      (node) => node.qualifiedName === "Handle.spawn",
    );
    const genericGet = dump.nodes.find(
      (node) => node.qualifiedName === "Generic.get",
    );
    const handleSchedule = dump.nodes.find(
      (node) => node.qualifiedName === "Handle.schedule",
    );
    const unsafeTarget = dump.nodes.find(
      (node) => node.name === "UnsafeTarget",
    );
    const unsafeSchedule = dump.nodes.find(
      (node) => node.qualifiedName === "UnsafeTarget.unsafe_schedule",
    );
    const late = dump.nodes.find((node) => node.name === "Late");
    const beforeDeclaration = dump.nodes.find(
      (node) => node.qualifiedName === "Late.before_declaration",
    );
    const wrappedLate = dump.nodes.find(
      (node) => node.name === "WrappedLate",
    );
    const wrappedBeforeDeclaration = dump.nodes.find(
      (node) =>
        node.qualifiedName === "WrappedLate.wrapped_before_declaration",
    );
    const wrappedLocal = dump.nodes.find(
      (node) =>
        node.qualifiedName ===
        "WrappedLate.wrapped_before_declaration.local",
    );

    TestValidator.predicate(
      `${lane}: Rust impl methods keep their concrete owner`,
      runtimeSpawn !== undefined &&
        runtimeBlockOn !== undefined &&
        handleSpawn !== undefined &&
        runtimeSpawn.id !== handleSpawn.id,
    );
    TestValidator.predicate(
      `${lane}: separate impl blocks attach to the same declared type`,
      runtime !== undefined &&
        [runtimeSpawn, runtimeBlockOn].every(
          (member) =>
            member !== undefined &&
            dump.edges.some(
              (edge) =>
                edge.kind === "contains" &&
                edge.from === runtime.id &&
                edge.to === member.id,
            ),
        ) &&
        handle !== undefined &&
        handleSpawn !== undefined &&
        dump.edges.some(
          (edge) =>
            edge.kind === "contains" &&
            edge.from === handle.id &&
            edge.to === handleSpawn.id,
        ),
    );
    TestValidator.equals(
      `${lane}: a bare pub Rust declaration is exported`,
      dump.nodes.find((node) => node.name === "public_api")?.exported,
      true,
    );
    TestValidator.equals(
      `${lane}: a crate-visible Rust declaration is not consumer API`,
      dump.nodes.find((node) => node.name === "crate_only")?.exported,
      undefined,
    );
    TestValidator.equals(
      `${lane}: a private Rust declaration is not exported`,
      dump.nodes.find((node) => node.name === "private_helper")?.exported,
      undefined,
    );
    TestValidator.predicate(
      `${lane}: impl methods are not module exports`,
      [runtimeSpawn, runtimeBlockOn, handleSpawn].every(
        (node) => node?.exported === undefined,
      ),
    );
    TestValidator.predicate(
      `${lane}: generic and trait impls resolve to a declared nominal owner`,
      genericGet !== undefined && handleSchedule !== undefined,
    );
    TestValidator.predicate(
      `${lane}: undeclared impl targets keep distinct qualified methods`,
      dump.nodes.some(
        (node) => node.qualifiedName === "External.collision",
      ) &&
        dump.nodes.some((node) => node.qualifiedName === "().collision"),
    );
    TestValidator.predicate(
      `${lane}: unsafe impls keep ownership`,
      unsafeTarget !== undefined &&
        unsafeSchedule !== undefined &&
        dump.edges.some(
          (edge) =>
            edge.kind === "contains" &&
            edge.from === unsafeTarget.id &&
            edge.to === unsafeSchedule.id,
        ),
    );
    TestValidator.predicate(
      `${lane}: impl ownership does not depend on declaration order`,
      late !== undefined &&
        beforeDeclaration !== undefined &&
        dump.edges.some(
          (edge) =>
            edge.kind === "contains" &&
            edge.from === late.id &&
            edge.to === beforeDeclaration.id,
        ),
    );
    TestValidator.predicate(
      `${lane}: late nominal owners are recovered from wrapper self types`,
      wrappedLate !== undefined &&
        wrappedBeforeDeclaration !== undefined &&
        wrappedLocal !== undefined &&
        dump.edges.some(
          (edge) =>
            edge.kind === "contains" &&
            edge.from === wrappedLate.id &&
            edge.to === wrappedBeforeDeclaration.id,
        ) &&
        dump.edges.some(
          (edge) =>
            edge.kind === "contains" &&
            edge.from === wrappedBeforeDeclaration.id &&
            edge.to === wrappedLocal.id,
        ),
    );
    TestValidator.predicate(
      `${lane}: restricted Rust declarations remain indexed but unexported`,
      ["super_only", "scoped_only", "LOCAL"].every((name) => {
        const node = dump.nodes.find((candidate) => candidate.name === name);
        return node !== undefined && node.exported === undefined;
      }),
    );
    TestValidator.predicate(
      `${lane}: unrestricted Rust static and union declarations are exported`,
      ["GLOBAL", "GLOBAL_MUT", "Packet", "public_module", "ffi_entry"].every(
        (name) =>
          dump.nodes.find((candidate) => candidate.name === name)?.exported ===
          true,
      ),
    );
  };

  validate("LSP", lspDump);
  validate("static", staticDump);
};
