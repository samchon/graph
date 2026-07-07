import { AsyncSamchonGraphSource } from "./AsyncSamchonGraphSource";
import { GraphMemory } from "./model/GraphMemory";
import { resultGuide, resultNext } from "./operations/common";
import { runDetails } from "./operations/runDetails";
import { runEntrypoints } from "./operations/runEntrypoints";
import { runLookup } from "./operations/runLookup";
import { runOverview } from "./operations/runOverview";
import { runTour } from "./operations/runTour";
import { runTrace } from "./operations/runTrace";
import { IGraphEscape, ISamchonGraphApplication } from "./structures";

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
    // Cache the built graph on success only. Caching a rejected promise would
    // brick the resident server for the whole session after one transient index
    // failure (e.g. a slow language-server cold start); clear it so the next
    // call rebuilds.
    if (this.promise === undefined) {
      this.promise = Promise.resolve(this.graph()).catch((error: unknown) => {
        this.promise = undefined;
        throw error;
      });
    }
    return this.promise;
  }
}
