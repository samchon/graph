import {
  ISamchonGraphDiagnostic,
  ISamchonGraphEdge,
  ISamchonGraphNode,
} from "../../structures";
import { GraphLanguage } from "../../typings";

/** Versioned JSON artifact emitted by a compiler/analyzer sidecar. */
export interface ISidecarSnapshot {
  schemaVersion: 1;
  projectRoot: string;
  languages: GraphLanguage[];

  tool: {
    name: string;
    version: string;
    compilerVersion: string;
    protocolVersion: number;
  };

  /** Producer-owned build/configuration fingerprint. */
  universe: string;

  /** Explicit facts about collection; emptiness never implies support. */
  capabilities: string[];

  /** JSON form of the normalized source manifest. */
  sources: Array<{
    file: string;
    checkerDigest: string;
    diskDigest: string;
  }>;

  nodes: ISamchonGraphNode[];
  edges: ISamchonGraphEdge[];
  diagnostics: ISamchonGraphDiagnostic[];
  warnings: string[];
}
