import type { GraphSitterLanguage } from "../typings";

/** One already-discovered source file supplied to the pure syntax extractor. */
export interface IGraphSitterFile {
  absolutePath: string;
  relativePath: string;
  language: GraphSitterLanguage;
  source: string;
}

/** Project snapshot to parse without owning filesystem or workspace discovery. */
export interface IGraphSitterOptions {
  root: string;
  files: IGraphSitterFile[];
}
