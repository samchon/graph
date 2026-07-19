import { IResidentGraphSource } from "../indexer/IResidentGraphSource";
import { SamchonGraphMemory } from "../SamchonGraphMemory";
import { SamchonGraphSourceReader } from "../SamchonGraphSourceReader";
import { ISamchonGraphDump } from "../structures";

/**
 * Adapt a resident dump source to the graph engine without reparsing an
 * unchanged snapshot on every MCP call.
 *
 * `createResidentGraphSource` preserves dump identity until a serialized
 * refresh publishes a replacement. Keying this cache by that identity gives
 * the server the same contract as `TtscGraphSession`: unchanged calls reuse the
 * exact warm memory, while a changed dump is converted before it replaces the
 * prior value. A failed conversion is therefore never cached.
 *
 * @internal Resident server adapter, exported only for lifecycle tests.
 */
export function createResidentGraphMemorySource(
  resident: IResidentGraphSource,
): () => Promise<SamchonGraphMemory> {
  let currentDump: ISamchonGraphDump | undefined;
  let currentMemory: SamchonGraphMemory | undefined;
  return async () => {
    const dump = await resident.load();
    if (currentMemory === undefined || dump !== currentDump) {
      const replacement = SamchonGraphMemory.from(
        dump,
        resident.source?.() ?? SamchonGraphSourceReader.none(dump.project),
      );
      currentDump = dump;
      currentMemory = replacement;
    }
    return currentMemory;
  };
}
