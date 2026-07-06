export interface IGraphNext {
  action: "answer" | "inspect" | "outside" | "clarify";
  request?:
    | "entrypoints"
    | "lookup"
    | "trace"
    | "details"
    | "overview"
    | "tour";
  reason: string;
}
