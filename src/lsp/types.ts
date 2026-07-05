export interface IPosition {
  line: number;
  character: number;
}

export interface IRange {
  start: IPosition;
  end: IPosition;
}

export interface ILocation {
  uri: string;
  range: IRange;
}

export interface IDocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  range: IRange;
  selectionRange: IRange;
  children?: IDocumentSymbol[];
}

export interface ISymbolInformation {
  name: string;
  kind: number;
  location: ILocation;
  containerName?: string;
}

export interface IDiagnostic {
  range: IRange;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
}

export type DocumentSymbolResult = Array<IDocumentSymbol | ISymbolInformation> | null;

export function isDocumentSymbol(
  value: IDocumentSymbol | ISymbolInformation,
): value is IDocumentSymbol {
  return "selectionRange" in value;
}
