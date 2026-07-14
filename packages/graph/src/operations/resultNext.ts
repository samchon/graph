import { ISamchonGraphNext } from "../structures/ISamchonGraphNext";

/** A runner's result structure paired with the next-step calibration for it. */
export interface IRunnerOutput<T> {
  /** The graph result structure. */
  result: T;

  /** How to use the result next. */
  next: ISamchonGraphNext;
}

export function resultNext(
  action: ISamchonGraphNext["action"],
  reason: string,
  request?: ISamchonGraphNext["request"],
): ISamchonGraphNext {
  return {
    action,
    reason,
    ...(request !== undefined ? { request } : {}),
  };
}
