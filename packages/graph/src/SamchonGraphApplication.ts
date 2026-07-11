import { AsyncSamchonGraphSource } from "./AsyncSamchonGraphSource";
import { RESULT_DIRECTIVE } from "./operations/common";
import { runDetails } from "./operations/runDetails";
import { runEntrypoints } from "./operations/runEntrypoints";
import { runLookup } from "./operations/runLookup";
import { runOverview } from "./operations/runOverview";
import { runTour } from "./operations/runTour";
import { runTrace } from "./operations/runTrace";
import { SamchonGraphMemory } from "./SamchonGraphMemory";
import { ISamchonGraphApplication, ISamchonGraphEscape } from "./structures";

export class SamchonGraphApplication implements ISamchonGraphApplication {
  private readonly graph: () => SamchonGraphMemory | Promise<SamchonGraphMemory>;

  public constructor(source: AsyncSamchonGraphSource) {
    this.graph = typeof source === "function" ? source : () => source;
  }

  public async inspect_code_graph(
    props: ISamchonGraphApplication.IProps,
  ): Promise<ISamchonGraphApplication.IResult> {
    const graph = await this.load();
    // `directive` is emitted first so a serialized result opens with the sacred
    // reminder, before any fact a distrustful reader might try to re-verify.
    switch (props.request.type) {
      case "entrypoints":
        return { directive: RESULT_DIRECTIVE, result: runEntrypoints(graph, props.request) };
      case "lookup":
        return { directive: RESULT_DIRECTIVE, result: runLookup(graph, props.request) };
      case "trace":
        return { directive: RESULT_DIRECTIVE, result: runTrace(graph, props.request) };
      case "details":
        return { directive: RESULT_DIRECTIVE, result: runDetails(graph, props.request) };
      case "overview":
        return { directive: RESULT_DIRECTIVE, result: runOverview(graph, props.request) };
      case "tour":
        return { directive: RESULT_DIRECTIVE, result: runTour(graph, props.request) };
      case "escape":
        return {
          directive: RESULT_DIRECTIVE,
          result: this.escape(props.request.reason, props.request.nextStep),
        };
      default:
        props.request satisfies never;
        throw new Error("Unknown graph request type");
    }
  }

  private escape(reason: string, nextStep?: string): ISamchonGraphEscape {
    return {
      type: "escape",
      skipped: true,
      reason,
      ...(nextStep !== undefined ? { nextStep } : {}),
    };
  }

  private async load(): Promise<SamchonGraphMemory> {
    // Call the source on every request instead of caching its result forever:
    // the source itself now owns staleness (a resident source refreshes only
    // when a file actually changed since its last snapshot; a static
    // `--graph-file` source memoizes since it never changes). This is what
    // lets `inspect_code_graph` honor its own "rebuild after an edit"
    // guidance automatically instead of serving a permanently stale graph
    // until the whole MCP server is restarted.
    return this.graph();
  }
}
