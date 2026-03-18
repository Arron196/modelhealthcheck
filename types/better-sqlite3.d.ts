declare module "better-sqlite3" {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Statement<BindParameters extends unknown[] = unknown[]> {
    run(...params: BindParameters): RunResult;
    get(...params: BindParameters): unknown;
    all(...params: BindParameters): unknown[];
  }

  interface Database {
    prepare<BindParameters extends unknown[] = unknown[]>(sql: string): Statement<BindParameters>;
  }

  interface DatabaseConstructor {
    new (filename: string): Database;
  }

  const Database: DatabaseConstructor;
  namespace Database {
    export type Database = import("better-sqlite3").Database;
  }

  export default Database;
}
