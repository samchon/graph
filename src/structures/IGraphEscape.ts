import { IGraphNext } from "./IGraphNext";

export interface IGraphEscape {
  type: "escape";
  skipped: true;
  reason: string;
  nextStep?: string;
  next: IGraphNext;
  guide: string;
}

export namespace IGraphEscape {
  export interface IRequest {
    type: "escape";
    reason: string;
    nextStep?: string;
  }
}
