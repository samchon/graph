/** One re-export statement: where it pulls from, and which names it forwards. */
export interface IReexport {
  /** The module specifier as written (`./order`, `.models`, `crate::order`). */
  specifier: string;

  /**
   * The names forwarded, as they are spelled in the module they come from.
   * Absent for a whole-module re-export (`export * from`), which forwards every
   * name the target puts on the wire.
   */
  names?: string[];
}
