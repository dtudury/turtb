import { Repository } from './Repository.js'

/**
 * A Repository specialized for file trees.
 *
 * The committed value at each commit's dataAddress is a plain object mapping
 * relative file paths to their contents — strings for text files, Uint8Arrays
 * for binary files. This is the same shape that fileSync works with.
 *
 * FileRepository is the right place to put file-specific concerns that don't
 * belong in the generic Repository or in the sync layer:
 *   - per-file metadata (mtime, mode) if added later
 *   - file-tree diffing helpers
 *   - policy decisions (e.g. ignoring empty directories)
 *
 * Binary/text encoding decisions and .gitignore filtering live in fileSync,
 * since they depend on the local filesystem environment.
 */
export class FileRepository extends Repository {
  /**
   * The file tree from the last commit, or undefined if nothing committed.
   * Keys are relative paths; values are strings (text) or Uint8Arrays (binary).
   * @returns {Object.<string, string|Uint8Array>|undefined}
   */
  get files () {
    const commit = this.lastCommit
    if (!commit) return undefined
    return this.decode(commit.dataAddress)
  }
}
