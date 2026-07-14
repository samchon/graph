import { ISamchonGraphNext } from "../structures";

/** A runner's result structure paired with the next-step calibration for it. */
export interface IRunnerOutput<T> {
  /** The graph result structure. */
  result: T;

  /** How to use the result next. */
  next: ISamchonGraphNext;
}
