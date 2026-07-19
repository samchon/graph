export interface IWalkOptions {
  extensions: ReadonlySet<string>;
  ignoreDirs?: ReadonlySet<string>;
  maxFiles?: number;
  /**
   * Descend into nested git repositories and worktrees instead of stopping at
   * their `.git` marker. Defaults to `false` so a nested agent worktree, a
   * vendored clone, or a submodule cannot merge a foreign checkout into this
   * graph or win a `maxFiles` cap. Set `true` only to intentionally index a
   * vendored repository as part of the requested root.
   */
  allowNestedRepositories?: boolean;
}
