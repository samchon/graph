import { IDocumentSymbol } from "./IDocumentSymbol";
import { ISymbolInformation } from "./ISymbolInformation";

export type DocumentSymbolResult = Array<IDocumentSymbol | ISymbolInformation> | null;
