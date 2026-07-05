import { GraphMemory } from "./model/GraphMemory";
import { runDetails } from "./operations/runDetails";
import { runEntrypoints } from "./operations/runEntrypoints";
import { resultGuide, resultNext } from "./operations/common";
import { runLookup } from "./operations/runLookup";
import { runOverview } from "./operations/runOverview";
import { runTour } from "./operations/runTour";
import { runTrace } from "./operations/runTrace";
import { IGraphEscape, ISamchonGraphApplication } from "./structures";

export type SamchonGraphSource = GraphMemory | (() => GraphMemory);
export type AsyncSamchonGraphSource =
  | GraphMemory
  | (() => GraphMemory | Promise<GraphMemory>);

export class SamchonGraphApplication implements ISamchonGraphApplication {
  private readonly graph: () => GraphMemory | Promise<GraphMemory>;
  private promise?: Promise<GraphMemory>;

  public constructor(source: AsyncSamchonGraphSource) {
    this.graph = typeof source === "function" ? source : () => source;
  }

  public async inspect_code_graph(
    props: ISamchonGraphApplication.IProps,
  ): Promise<ISamchonGraphApplication.IResult> {
    const graph = await this.load();
    switch (props.request.type) {
      case "entrypoints":
        return { result: runEntrypoints(graph, props.request) };
      case "lookup":
        return { result: runLookup(graph, props.request) };
      case "trace":
        return { result: runTrace(graph, props.request) };
      case "details":
        return { result: runDetails(graph, props.request) };
      case "overview":
        return { result: runOverview(graph, props.request) };
      case "tour":
        return { result: runTour(graph, props.request) };
      case "escape":
        return { result: this.escape(props.request.reason, props.request.nextStep) };
      default:
        props.request satisfies never;
        throw new Error("Unknown graph request type");
    }
  }

  private escape(reason: string, nextStep?: string): IGraphEscape {
    return {
      type: "escape",
      skipped: true,
      reason,
      ...(nextStep !== undefined ? { nextStep } : {}),
      next: resultNext(
        "outside",
        nextStep ?? "Graph evidence is exhausted or not the next evidence source.",
      ),
      guide: resultGuide(
        "Finish from existing graph evidence, state the graph gap, or ask for clarification.",
      ),
    };
  }

  private async load(): Promise<GraphMemory> {
    this.promise ??= Promise.resolve(this.graph());
    return this.promise;
  }
}
