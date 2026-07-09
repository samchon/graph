import { SamchonGraphMemory } from "./SamchonGraphMemory";

export type AsyncSamchonGraphSource =
  | SamchonGraphMemory
  | (() => SamchonGraphMemory | Promise<SamchonGraphMemory>);
