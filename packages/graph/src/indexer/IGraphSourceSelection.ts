import { GraphLanguage } from "../typings";

/** One deterministic, globally capped source snapshot partitioned by language. */
export interface IGraphSourceSelection {
  /** Requested languages, deduplicated in caller order; discovery uses files. */
  languages: GraphLanguage[];
  /** Languages actually represented by the globally capped source set. */
  presentLanguages: GraphLanguage[];
  /** One deterministic global source set, before it is partitioned by language. */
  files: string[];
  /** The selected files that belong to each discovered/requested language. */
  byLanguage: Map<GraphLanguage, string[]>;
}
