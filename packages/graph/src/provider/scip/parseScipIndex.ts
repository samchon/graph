import { IScipIndex } from "./IScipIndex";

/**
 * Validate one decoded SCIP index before any of it is believed.
 *
 * Every field this graph reads is checked here, and a violation rejects the
 * whole index rather than skipping the offending record. A partially accepted
 * index is the failure mode worth avoiding: the missing facts are silent, so a
 * consumer cannot distinguish "this symbol has no references" from "the record
 * carrying them was malformed and dropped", and the audit riding on the result
 * asserts the first.
 */
export function parseScipIndex(value: unknown, label = "scip"): IScipIndex {
  const index = objectOf(value, label);
  const metadata = objectOf(index.metadata, `${label}.metadata`);
  const documents = arrayOf(index.documents, `${label}.documents`);
  const seen = new Set<string>();
  return {
    metadata: {
      ...optionalString(metadata.version, `${label}.metadata.version`, "version"),
      ...(metadata.toolInfo === undefined
        ? {}
        : { toolInfo: toolInfoOf(metadata.toolInfo, `${label}.metadata.toolInfo`) }),
      projectRoot: stringOf(
        metadata.projectRoot,
        `${label}.metadata.projectRoot`,
      ),
      ...optionalString(
        metadata.textDocumentEncoding,
        `${label}.metadata.textDocumentEncoding`,
        "textDocumentEncoding",
      ),
    },
    documents: documents.map((document, index) => {
      const parsed = documentOf(document, `${label}.documents[${index}]`);
      // One document per path. Two records for one file cannot both be the
      // complete occurrence list for it, and merging them would double every
      // reference they share while hiding which of the two the reader got.
      if (seen.has(parsed.relativePath)) {
        throw new Error(
          `scip: two documents describe ${parsed.relativePath}, so neither is its complete occurrence list`,
        );
      }
      seen.add(parsed.relativePath);
      return parsed;
    }),
    ...(index.externalSymbols === undefined
      ? {}
      : {
          externalSymbols: arrayOf(
            index.externalSymbols,
            `${label}.externalSymbols`,
          ).map((symbol, at) =>
            symbolInformationOf(symbol, `${label}.externalSymbols[${at}]`),
          ),
        }),
  };
}

function documentOf(value: unknown, label: string): IScipIndex.IDocument {
  const document = objectOf(value, label);
  const relativePath = stringOf(document.relativePath, `${label}.relativePath`);
  if (relativePath === "") {
    throw new Error(`scip: ${label}.relativePath is empty`);
  }
  // A document path is workspace-relative by definition. An absolute or
  // parent-escaping path would attribute facts to a file outside the program
  // this index claims to describe.
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(relativePath)) {
    throw new Error(
      `scip: ${label}.relativePath must be workspace-relative: ${relativePath}`,
    );
  }
  if (relativePath.split(/[\\/]/).includes("..")) {
    throw new Error(
      `scip: ${label}.relativePath escapes the workspace: ${relativePath}`,
    );
  }
  return {
    ...optionalString(document.language, `${label}.language`, "language"),
    relativePath,
    ...(document.occurrences === undefined
      ? {}
      : {
          occurrences: arrayOf(
            document.occurrences,
            `${label}.occurrences`,
          ).map((occurrence, at) =>
            occurrenceOf(occurrence, `${label}.occurrences[${at}]`),
          ),
        }),
    ...(document.symbols === undefined
      ? {}
      : {
          symbols: arrayOf(document.symbols, `${label}.symbols`).map(
            (symbol, at) =>
              symbolInformationOf(symbol, `${label}.symbols[${at}]`),
          ),
        }),
    // The one field that lets a snapshot say which bytes its facts came from.
    // Most indexers omit it; when present it is the only honest source of a
    // checker digest, because everything else this client can read is a later
    // instant.
    ...optionalString(document.text, `${label}.text`, "text"),
    ...optionalString(
      document.positionEncoding,
      `${label}.positionEncoding`,
      "positionEncoding",
    ),
    ...(document.diagnostics === undefined
      ? {}
      : {
          diagnostics: arrayOf(
            document.diagnostics,
            `${label}.diagnostics`,
          ).map((diagnostic, at) =>
            diagnosticOf(diagnostic, `${label}.diagnostics[${at}]`),
          ),
        }),
  };
}

function occurrenceOf(value: unknown, label: string): IScipIndex.IOccurrence {
  const occurrence = objectOf(value, label);
  return {
    range: rangeOf(occurrence.range, `${label}.range`),
    symbol: nonEmptyString(occurrence.symbol, `${label}.symbol`),
    ...(occurrence.symbolRoles === undefined
      ? {}
      : {
          symbolRoles: roleMaskOf(
            occurrence.symbolRoles,
            `${label}.symbolRoles`,
          ),
        }),
    ...optionalString(occurrence.syntaxKind, `${label}.syntaxKind`, "syntaxKind"),
    ...(occurrence.enclosingRange === undefined
      ? {}
      : {
          enclosingRange: rangeOf(
            occurrence.enclosingRange,
            `${label}.enclosingRange`,
          ),
        }),
    // Kept, because this is where a diagnostic gets a position. Dropping it
    // left the adapter with nothing but document-level findings, every one of
    // which it then had to report at the top of the file.
    ...(occurrence.diagnostics === undefined
      ? {}
      : {
          diagnostics: arrayOf(
            occurrence.diagnostics,
            `${label}.diagnostics`,
          ).map((diagnostic, at) =>
            diagnosticOf(diagnostic, `${label}.diagnostics[${at}]`),
          ),
        }),
  };
}

function symbolInformationOf(
  value: unknown,
  label: string,
): IScipIndex.ISymbolInformation {
  const symbol = objectOf(value, label);
  return {
    symbol: nonEmptyString(symbol.symbol, `${label}.symbol`),
    ...optionalString(symbol.displayName, `${label}.displayName`, "displayName"),
    ...optionalString(symbol.kind, `${label}.kind`, "kind"),
    ...(symbol.documentation === undefined
      ? {}
      : {
          documentation: arrayOf(
            symbol.documentation,
            `${label}.documentation`,
          ).map((line, at) => stringOf(line, `${label}.documentation[${at}]`)),
        }),
    ...(symbol.relationships === undefined
      ? {}
      : {
          relationships: arrayOf(
            symbol.relationships,
            `${label}.relationships`,
          ).map((relationship, at) =>
            relationshipOf(relationship, `${label}.relationships[${at}]`),
          ),
        }),
    ...optionalString(
      symbol.enclosingSymbol,
      `${label}.enclosingSymbol`,
      "enclosingSymbol",
    ),
  };
}

function relationshipOf(
  value: unknown,
  label: string,
): IScipIndex.IRelationship {
  const relationship = objectOf(value, label);
  return {
    symbol: nonEmptyString(relationship.symbol, `${label}.symbol`),
    ...flag(relationship.isReference, `${label}.isReference`, "isReference"),
    ...flag(
      relationship.isImplementation,
      `${label}.isImplementation`,
      "isImplementation",
    ),
    ...flag(
      relationship.isTypeDefinition,
      `${label}.isTypeDefinition`,
      "isTypeDefinition",
    ),
    ...flag(relationship.isDefinition, `${label}.isDefinition`, "isDefinition"),
  };
}

function diagnosticOf(value: unknown, label: string): IScipIndex.IDiagnostic {
  const diagnostic = objectOf(value, label);
  return {
    message: stringOf(diagnostic.message, `${label}.message`),
    ...optionalString(diagnostic.severity, `${label}.severity`, "severity"),
    ...optionalString(diagnostic.code, `${label}.code`, "code"),
    ...optionalString(diagnostic.source, `${label}.source`, "source"),
  };
}

function toolInfoOf(value: unknown, label: string): IScipIndex.IToolInfo {
  const info = objectOf(value, label);
  return {
    name: stringOf(info.name, `${label}.name`),
    ...optionalString(info.version, `${label}.version`, "version"),
  };
}

/**
 * A zero-based SCIP range, as three or four non-negative integers.
 *
 * The three-element form is the single-line shorthand
 * `[line, startCharacter, endCharacter]`; the four-element form spans lines. A
 * range whose end precedes its start is rejected rather than normalized: it
 * names no text, and silently swapping the ends would invent a span the
 * indexer never reported.
 */
function rangeOf(value: unknown, label: string): number[] {
  const range = arrayOf(value, label);
  if (range.length !== 3 && range.length !== 4) {
    throw new Error(
      `scip: ${label} must have three or four elements, not ${String(range.length)}`,
    );
  }
  const numbers = range.map((entry, index) => {
    if (
      typeof entry !== "number" ||
      !Number.isSafeInteger(entry) ||
      entry < 0
    ) {
      throw new Error(
        `scip: ${label}[${String(index)}] must be a non-negative integer`,
      );
    }
    return entry;
  });
  const [startLine, startCharacter] = numbers as [number, number, ...number[]];
  const endLine = numbers.length === 3 ? startLine : numbers[2]!;
  const endCharacter = numbers.length === 3 ? numbers[2]! : numbers[3]!;
  if (
    endLine < startLine ||
    (endLine === startLine && endCharacter < startCharacter)
  ) {
    throw new Error(`scip: ${label} ends before it starts`);
  }
  return numbers;
}

function roleMaskOf(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`scip: ${label} must be a non-negative integer bitmask`);
  }
  return value;
}

function flag<K extends string>(
  value: unknown,
  label: string,
  key: K,
): Partial<Record<K, boolean>> {
  if (value === undefined) return {};
  if (typeof value !== "boolean") {
    throw new Error(`scip: ${label} must be a boolean`);
  }
  return { [key]: value } as Record<K, boolean>;
}

function optionalString<K extends string>(
  value: unknown,
  label: string,
  key: K,
): Partial<Record<K, string>> {
  if (value === undefined) return {};
  return { [key]: stringOf(value, label) } as Record<K, string>;
}

function nonEmptyString(value: unknown, label: string): string {
  const text = stringOf(value, label);
  if (text === "") throw new Error(`scip: ${label} is empty`);
  return text;
}

function stringOf(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`scip: ${label} must be a string`);
  }
  return value;
}

function arrayOf(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`scip: ${label} must be an array`);
  }
  return value;
}

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`scip: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}
