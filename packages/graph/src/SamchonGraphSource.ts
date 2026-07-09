import { SamchonGraphMemory } from "./SamchonGraphMemory";

export type SamchonGraphSource = SamchonGraphMemory | (() => SamchonGraphMemory);
