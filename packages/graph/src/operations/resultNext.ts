import { ISamchonGraphNext } from "../structures";

export function resultNext(
  action: ISamchonGraphNext["action"],
  reason: string,
  request?: ISamchonGraphNext["request"],
): ISamchonGraphNext {
  return request === undefined
    ? { action, reason }
    : { action, request, reason };
}
