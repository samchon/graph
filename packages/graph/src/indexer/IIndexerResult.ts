import { ISamchonGraphDump } from "../structures";
import { GraphLanguage } from "../typings";
import { SamchonGraphSourceReader } from "../SamchonGraphSourceReader";
import { IBulkGraphSession } from "../provider/IBulkGraphSession";
import { IGraphProvider } from "../provider/IGraphProvider";
import { ILspSession } from "./ILspSession";

export interface IIndexerResult {
  dump: ISamchonGraphDump;
  warnings: string[];
  /** Present only when `options.keepAlive` was set: one live session per
   * language that produced real LSP data, for a resident graph to refresh
   * from later without paying `initialize` again. */
  sessions?: Map<GraphLanguage, ILspSession | IBulkGraphSession>;
  /**
   * Exact source text used to build the dump, keyed by absolute path.
   * Present for resident builds so freshness hashes describe the indexed
   * snapshot rather than a later disk state.
   *
   * Only the lanes that read text themselves appear here: a bulk provider
   * publishes a digest manifest and never the bytes, so its files are absent.
   * Nothing is lost by that. The freshness hashes this feeds already skip every
   * bulk language — a compiler-owned session reports its own generation, which
   * is a better answer than re-hashing the disk behind its back — and the file
   * set the graph is finalized against comes from the session's manifest.
   */
  sources?: Map<string, string>;

  /** Immutable source-display evidence captured with this exact dump. */
  source?: SamchonGraphSourceReader;

  /**
   * What each contributing provider did to compute this build, by provider
   * name.
   *
   * Reported here rather than in the dump because computation mode is a
   * property of one refresh, not of the facts: a session that reused its
   * resident program and a cold build that loaded it from scratch can publish
   * identical facts, and recording the difference inside the dump would make
   * two dumps of the same unedited checkout differ. Experiments and the
   * conformance harness measure incrementality from this; a generation counter
   * cannot, because a reuse and a full rebuild both move it by one.
   */
  modes?: Map<string, IBulkGraphSession.Mode>;

  /**
   * The registry entry behind each kept strict session, by language.
   *
   * Present only with `keepAlive`, and only so a resident source can hold every
   * *later* snapshot to the same contract as the first. Without it the
   * contract check would run once, on the initial build, and a provider whose
   * second generation published an unclaimed edge family or a foreign
   * language's nodes would be merged into the dump unexamined — which is
   * exactly the generation a long-lived session spends all its time in.
   */
  providers?: Map<GraphLanguage, IGraphProvider>;

  /** Project-wide source/config/build inputs fenced around this build. */
  inputManifest?: Map<string, string>;

  /** Languages whose source contents remain opaque to the coordinator. */
  inputManifestLanguages?: GraphLanguage[];

  /** Provider-declared non-source inputs retained for resident recapture. */
  buildInputs?: string[];
}
