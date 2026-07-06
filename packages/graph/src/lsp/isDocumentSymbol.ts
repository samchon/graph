import { IDocumentSymbol } from "./IDocumentSymbol";
import { ISymbolInformation } from "./ISymbolInformation";

export function isDocumentSymbol(
  value: IDocumentSymbol | ISymbolInformation,
): value is IDocumentSymbol {
  return "selectionRange" in value;
}
