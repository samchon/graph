import { GraphMemory } from "./model/GraphMemory";

export type AsyncSamchonGraphSource =
  | GraphMemory
  | (() => GraphMemory | Promise<GraphMemory>);
