import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDocument, openCompilerStore, type DocumentFixture } from "./compiler";

async function temporaryStore(run: (path: string, db: Database) => Promise<void>) {
  const path = await mkdtemp(join(tmpdir(), "reading-os-compiler-"));
  const db = openCompilerStore(join(path, "facts.sqlite"));
  try {
    await run(path, db);
  } finally {
    db.close();
    await rm(path, { recursive: true, force: true });
  }
}

const targets = [
  { id: "input", question: "Which argument carries metadata?", valueKind: "identifier" },
  { id: "count", question: "How many metrics?", valueKind: "number" },
] as const;

async function prepare(path: string, version: string, input: string, newline = "\n") {
  const text = [`Use ${input} for metadata.`, "Use a single metric.", ""].join(newline);
  const fixture: DocumentFixture = {
    id: `demo-${version}`,
    workId: "demo.work",
    version,
    sha256: createHash("sha256").update(text).digest("hex"),
    reference: "https://example.test/source",
    spans: [
      { id: "metadata", start: 1, end: 1 },
      { id: "metrics", start: 2, end: 2 },
    ],
    targets,
  };
  const file = join(path, `source-${version}.txt`);
  await writeFile(file, text);
  return { fixture, file };
}

function answer(value: string, claim = "Send metadata through the documented argument.") {
  return {
    claims: [
      { targetId: "input", value, claim, evidenceId: "metadata" },
      { targetId: "count", value: "1", claim: "Only one metric is permitted.", evidenceId: "metrics" },
    ],
  };
}

function count(db: Database, table: "knowledge" | "observations" | "compilations") {
  return db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n;
}

test("reads verified bytes, binds the exact source range and survives closing the database", async () => {
  await temporaryStore(async (path, db) => {
    const { file, fixture } = await prepare(path, "1.0.0", "params", "\r\n");
    const result = await compileDocument(db, fixture, file, async ({ spans }) => {
      expect(spans.map((span) => span.text)).toEqual(["Use params for metadata.", "Use a single metric."]);
      return answer("params");
    });
    expect(result.claims[0]?.evidence).toEqual({
      sourceHash: fixture.sha256,
      reference: "https://example.test/source#L1-L1",
      start: 1,
      end: 1,
      text: "Use params for metadata.",
      spanId: "metadata",
    });
    const reopened = openCompilerStore(join(path, "facts.sqlite"));
    try {
      expect(count(reopened, "observations")).toBe(2);
      expect(
        reopened.query<{ claim: string }, []>("SELECT claim FROM observations WHERE target_id='count'").get(),
      ).toEqual({ claim: "Only one metric is permitted." });
    } finally {
      reopened.close();
    }
  });
});

test("deduplicates an unchanged value across versions and preserves changed values and their evidence", async () => {
  await temporaryStore(async (path, db) => {
    const older = await prepare(path, "1.3.2", "groups");
    const newer = await prepare(path, "1.4.2", "params");
    await compileDocument(db, older.fixture, older.file, async () => answer("groups"));
    await compileDocument(db, newer.fixture, newer.file, async () => ({
      ...answer("params"),
      claims: [
        answer("params").claims[0],
        {
          targetId: "count",
          value: "1.0",
          claim: "The API supports a single metric.",
          evidenceId: "metrics",
        },
      ],
    }));
    expect(count(db, "knowledge")).toBe(3);
    expect(count(db, "observations")).toBe(4);
    expect(
      db
        .query<{ version: string; value: string }, []>(
          "SELECT version, value FROM observations WHERE target_id='input' ORDER BY version",
        )
        .all(),
    ).toEqual([
      { version: "1.3.2", value: "groups" },
      { version: "1.4.2", value: "params" },
    ]);
    const result = await compileDocument(db, newer.fixture, newer.file, async () => {
      throw new Error("replaying a successful version must not call the model");
    });
    expect(result.replayed).toBe(true);
    expect(count(db, "observations")).toBe(4);
  });
});

test("rejects a same-version source change while preserving the committed record", async () => {
  await temporaryStore(async (path, db) => {
    const before = await prepare(path, "1.3.2", "groups");
    await compileDocument(db, before.fixture, before.file, async () => answer("groups"));
    const edited = await prepare(path, "1.3.2", "params");
    await expect(compileDocument(db, edited.fixture, edited.file, async () => answer("params"))).rejects.toThrow(
      "version conflict",
    );
    expect(count(db, "observations")).toBe(2);
    expect(db.query<{ value: string }, []>("SELECT value FROM observations WHERE target_id='input'").get()).toEqual({
      value: "groups",
    });
  });
});

test("fails closed on evidence not supplied by the host and leaves no partial write", async () => {
  await temporaryStore(async (path, db) => {
    const { file, fixture } = await prepare(path, "1.0.0", "params");
    await expect(
      compileDocument(db, fixture, file, async () => ({
        claims: [answer("params").claims[0], { ...answer("params").claims[1], evidenceId: "outside" }],
      })),
    ).rejects.toThrow("Unbound evidence");
    expect(count(db, "knowledge")).toBe(0);
    expect(count(db, "observations")).toBe(0);
    expect(count(db, "compilations")).toBe(0);
  });
});

test("checks the source digest before attempting inference", async () => {
  await temporaryStore(async (path, db) => {
    const { file, fixture } = await prepare(path, "1.0.0", "params");
    await writeFile(file, "Different document");
    await expect(
      compileDocument(db, fixture, file, async () => {
        throw new Error("model should not receive altered file contents");
      }),
    ).rejects.toThrow("Source hash mismatch");
    expect(count(db, "compilations")).toBe(0);
  });
});

test("rejects duplicate objectives in the same response", async () => {
  await temporaryStore(async (path, db) => {
    const { file, fixture } = await prepare(path, "1.0.0", "params");
    const claim = answer("params").claims[0];
    await expect(compileDocument(db, fixture, file, async () => ({ claims: [claim, claim] }))).rejects.toThrow(
      "Invalid or duplicate target",
    );
    expect(count(db, "knowledge")).toBe(0);
  });
});

test("refuses to add prototype tables to an unrelated SQLite database", async () => {
  const path = await mkdtemp(join(tmpdir(), "reading-os-unrelated-"));
  const file = join(path, "existing.sqlite");
  const original = new Database(file);
  try {
    original.exec("CREATE TABLE reader_notes (body TEXT)");
    expect(() => openCompilerStore(file).close()).toThrow("not a Reading OS prototype database");
    expect(original.query("SELECT name FROM sqlite_schema WHERE type='table'").all()).toEqual([
      { name: "reader_notes" },
    ]);
  } finally {
    original.close();
    await rm(path, { recursive: true, force: true });
  }
});

test("two in-flight compilations settle as one persisted batch", async () => {
  await temporaryStore(async (path, db) => {
    const { file, fixture } = await prepare(path, "1.3.2", "groups");
    const another = openCompilerStore(join(path, "facts.sqlite"));
    let arrived = 0;
    const gate = Promise.withResolvers<void>();
    const select = async () => {
      arrived++;
      if (arrived === 2) gate.resolve();
      await gate.promise;
      return answer("groups");
    };
    try {
      const results = await Promise.all([
        compileDocument(db, fixture, file, select),
        compileDocument(another, fixture, file, select),
      ]);
      expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
      expect(count(db, "compilations")).toBe(1);
      expect(count(db, "observations")).toBe(2);
    } finally {
      another.close();
    }
  });
});
