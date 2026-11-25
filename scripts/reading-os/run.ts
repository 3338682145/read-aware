import { join } from "node:path";
import { compileDocument, inspectCompilerStore, openCompilerStore, type DocumentFixture } from "./compiler";
import { localExtractor } from "./inference";

const [command, database, fixtureId, sourceFolder] = process.argv.slice(2);
if (!database || !["compile", "inspect"].includes(command ?? "")) {
  throw new Error("Usage: bun scripts/reading-os/run.ts compile <db> <fixture-id> <source-dir> | inspect <db>");
}
const db = openCompilerStore(database);
try {
  if (command === "inspect") {
    console.log(JSON.stringify(inspectCompilerStore(db), null, 2));
  } else {
    if (!fixtureId || !sourceFolder || !["crossval-132", "crossval-142", "threshold-161"].includes(fixtureId)) {
      throw new Error("A frozen fixture ID and source directory are required");
    }
    const fixture = (await Bun.file(join(import.meta.dir, "eval", `${fixtureId}.json`)).json()) as DocumentFixture;
    const extract = localExtractor();
    const attempts: unknown[] = [];
    const start = performance.now();
    const result = await compileDocument(db, fixture, join(sourceFolder, `${fixture.id}.txt`), async (request) => {
      const result = await extract(request);
      attempts.push(...result.attempts);
      return result.value;
    });
    console.log(
      JSON.stringify({ fixtureId, ...result, attempts, wallMs: Math.round(performance.now() - start) }, null, 2),
    );
  }
} finally {
  db.close();
}
