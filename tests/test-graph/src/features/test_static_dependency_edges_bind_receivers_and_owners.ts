import { TestValidator } from "@nestia/e2e";

import {
  ISamchonGraphNode,
  staticDependencyEdges,
} from "@samchon/graph-sitter";
import type { GraphLanguage, GraphNodeKind } from "@samchon/graph-sitter";

const node = (
  id: string,
  kind: GraphNodeKind,
  name: string,
  language: GraphLanguage,
  qualifiedName?: string,
): ISamchonGraphNode => ({
  id,
  kind,
  name,
  language,
  file: "unit.src",
  external: false,
  ...(qualifiedName === undefined ? {} : { qualifiedName }),
});

const index = (
  ...nodes: readonly ISamchonGraphNode[]
): ReadonlyMap<string, readonly ISamchonGraphNode[]> => {
  const map = new Map<string, ISamchonGraphNode[]>();
  for (const declaration of nodes) {
    const bucket = map.get(declaration.name);
    if (bucket === undefined) map.set(declaration.name, [declaration]);
    else bucket.push(declaration);
  }
  return map;
};

const wires = (edges: readonly { kind: string; to: string }[]): string[] =>
  edges.map((edge) => `${edge.kind}:${edge.to}`);

/**
 * `staticDependencyEdges` reads a declaration body against the project's
 * name index. Three of its receiver/owner rules have no fixture in the language
 * suites: a C++ `->` pointer receiver, a Lua `self` receiver, and an owner
 * recovered from a qualified name whose final segment is not the simple name.
 */
export const test_static_dependency_edges_bind_receivers_and_owners = () => {
  // A `->` receiver reaches a sibling exactly as `this` would: the pointer names
  // the same owner, so `route` resolves its own type's `render`, not a twin.
  const cppOwner = "Widget.route";
  const cppTarget = "Widget.render";
  TestValidator.equals(
    "a C++ `this->` call resolves to the same owner's member",
    wires(
      staticDependencyEdges(
        node(cppOwner, "method", "route", "cpp", "Widget.route"),
        "this->render();",
        index(node(cppTarget, "method", "render", "cpp", "Widget.render")),
      ),
    ),
    [`calls:${cppTarget}`],
  );

  // Lua spells the receiver `self` and the call with a colon. `self` binds to
  // the enclosing owner, so `paint` resolves within `Panel` and nowhere else.
  const luaTarget = "Panel.paint";
  TestValidator.equals(
    "a Lua `self:` call resolves within the enclosing owner",
    wires(
      staticDependencyEdges(
        node("Panel.update", "method", "update", "lua", "Panel.update"),
        "self:paint();",
        index(node(luaTarget, "method", "paint", "lua", "Panel.paint")),
      ),
    ),
    [`calls:${luaTarget}`],
  );

  // The exported resolver accepts any node the graph hands it, including a
  // qualified name whose final segment is not the member's simple name. `ownerOf`
  // recovers the owner from the prefix before the last dot so the qualified
  // receiver still resolves.
  const dottedOwner = node("thing", "method", "thing", "cpp", "Space.other");
  TestValidator.equals(
    "a qualified receiver resolves through an owner read from the name prefix",
    wires(
      staticDependencyEdges(
        node("caller", "function", "caller", "cpp"),
        "Space.thing();",
        index(dottedOwner),
      ),
    ),
    ["calls:thing"],
  );

  // When the qualified name carries no dot at all, there is no owner to read: a
  // top-level reference still reaches it, and the owner recovery yields nothing.
  const looseTopLevel = node("solo", "function", "solo", "cpp", "lonely");
  TestValidator.equals(
    "a dotless qualified name exposes a member only at the top level",
    wires(
      staticDependencyEdges(
        node("root", "function", "root", "cpp"),
        "solo();",
        index(looseTopLevel),
      ),
    ),
    ["calls:solo"],
  );

  // An ancestor receiver (`super`) is not evidence of which inherited member is
  // dispatched: a same-name member on another owner is not the base's member, so
  // the reference stays unresolved across every language that spells `super`.
  TestValidator.equals(
    "a super receiver resolves to nothing without a base dispatch table",
    wires(
      staticDependencyEdges(
        node("Panel.repaint", "method", "repaint", "dart", "Panel.repaint"),
        "super.paint();",
        index(node("Base.paint", "method", "paint", "dart", "Base.paint")),
      ),
    ),
    [],
  );

  // `Self` in Swift names the enclosing type, so a `Self.` reference resolves
  // within the same owner exactly as an instance `self` would.
  TestValidator.equals(
    "a Swift `Self.` reference resolves within the enclosing type",
    wires(
      staticDependencyEdges(
        node("Shape.area", "method", "area", "swift", "Shape.area"),
        "Self.make();",
        index(node("Shape.make", "method", "make", "swift", "Shape.make")),
      ),
    ),
    ["calls:Shape.make"],
  );

  // A C++ anonymous namespace has no name a caller can write, so its members
  // answer to the enclosing (file) scope as well as their own literal owner.
  TestValidator.equals(
    "a C++ anonymous-namespace member is reachable from file scope",
    wires(
      staticDependencyEdges(
        node("driver", "function", "driver", "cpp"),
        "helper();",
        index(
          node(
            "(anonymous namespace).helper",
            "function",
            "helper",
            "cpp",
            "(anonymous namespace).helper",
          ),
        ),
      ),
    ),
    ["calls:(anonymous namespace).helper"],
  );

  // The only declaration a name indexes may be the source itself, reached under
  // an alias key. Filtering the source out leaves nothing, so no self-edge forms.
  const selfOnly = node("owner", "function", "owner", "cpp");
  TestValidator.equals(
    "a name that indexes only the source resolves to no edge",
    wires(
      staticDependencyEdges(
        selfOnly,
        "alias();",
        new Map([["alias", [selfOnly]]]),
      ),
    ),
    [],
  );

  // A source whose qualified name is a single segment has no lexical owner to
  // read; a bare reference still reaches a top-level declaration.
  TestValidator.equals(
    "a single-segment source name yields no owner but still resolves top level",
    wires(
      staticDependencyEdges(
        node("member", "method", "member", "cpp", "standalone"),
        "helper();",
        index(node("helper", "function", "helper", "cpp")),
      ),
    ),
    ["calls:helper"],
  );
};
