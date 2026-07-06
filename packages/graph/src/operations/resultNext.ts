import { IGraphNext } from "../structures";

export function resultNext(
  action: IGraphNext["action"],
  reason: string,
  request?: IGraphNext["request"],
): IGraphNext {
  return request === undefined ? { action, reason } : { action, request, reason };
}
