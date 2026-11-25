import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

type Target = { id: string; question: string; valueKind: "identifier" | "number" };
type Span = { id: string; start: number; end: number };
type SourceSpan = Span & { text: string };

export interface DocumentFixture {
  id: string;
  workId: string;
  version: string;
  sha256: string;
  reference: string;
  spans: readonly Span[];
  targets: readonly Target[];
}

export interface CompileRequest {
  workId: string;
  version: string;
  targets: readonly Target[];
  spans: readonly SourceSpan[];
}

type Evidence = {
  sourceHash: string;
  reference: string;
  start: number;
  end: number;
  text: string;
  spanId: string;
};

export interface BoundClaim {
  targetId: string;
  value: string;
  claim: string;
  evidence: Evidence;
}

export interface Compilation {
  workId: string;
  version: string;
  replayed: boolean;
  claims: BoundClaim[];
}

export function openCompilerStore(path: string): Database {
  const db = new Database(path, { strict: true });
  const applicationId = 0x524f534b;
  try {
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    db.transaction(() => {
      const marker = db.query<{ application_id: number }, []>("PRAGMA application_id").get()?.application_id;
      const hasObjects = db.query("SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get();
      if (marker !== applicationId && (marker !== 0 || hasObjects)) {
        throw new Error("This file is not a Reading OS prototype database");
      }
      db.exec(`
    PRAGMA application_id = ${applicationId};
    CREATE TABLE IF NOT EXISTS compilations (
      work_id TEXT NOT NULL,
      version TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      claims_json TEXT NOT NULL,
      PRIMARY KEY (work_id, version)
    );
    CREATE TABLE IF NOT EXISTS knowledge (
      work_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (work_id, target_id, value)
    );
    CREATE TABLE IF NOT EXISTS observations (
      work_id TEXT NOT NULL,
      version TEXT NOT NULL,
      target_id TEXT NOT NULL,
      value TEXT NOT NULL,
      claim TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      PRIMARY KEY (work_id, version, target_id),
      FOREIGN KEY (work_id, version) REFERENCES compilations (work_id, version),
      FOREIGN KEY (work_id, target_id, value) REFERENCES knowledge (work_id, target_id, value)
    );
      `);
    }).immediate();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readSpans(fixture: DocumentFixture, path: string): Promise<SourceSpan[]> {
  const bytes = await readFile(path);
  if (sha256(bytes) !== fixture.sha256) throw new Error(`Source hash mismatch for ${fixture.id}`);
  const lines = new TextDecoder("utf-8", { fatal: true }).decode(bytes).split(/\r?\n/);
  const ids = new Set<string>();
  return fixture.spans.map((span) => {
    const { id, start, end } = span;
    if (
      !id ||
      ids.has(id) ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < start ||
      end > lines.length
    )
      throw new Error(`Invalid source span: ${id}`);
    ids.add(id);
    const text = lines.slice(start - 1, end).join("\n");
    if (!text.trim()) throw new Error(`Empty source span: ${id}`);
    return { ...span, text };
  });
}

function normalizeValue(value: unknown, target: Target): string {
  if (typeof value !== "string") throw new Error(`Invalid value for ${target.id}`);
  const text = value.trim();
  if (target.valueKind === "identifier" && /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(text)) return text;
  if (target.valueKind === "number" && /^-?\d{1,12}(\.\d{1,8})?$/.test(text)) return String(Number(text));
  throw new Error(`Invalid value for ${target.id}`);
}

function bindClaims(value: unknown, fixture: DocumentFixture, source: SourceSpan[]): BoundClaim[] {
  const targets = new Map(fixture.targets.map((target) => [target.id, target]));
  const remaining = new Set(targets.keys());
  const spans = new Map(source.map((span) => [span.id, span]));
  const claims = (value as { claims?: unknown } | null)?.claims;
  if (!Array.isArray(claims)) throw new Error("Invalid extraction format");
  return claims.map((item: unknown) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const targetId = row.targetId;
    const target = typeof targetId === "string" ? targets.get(targetId) : undefined;
    if (!target || !remaining.delete(target.id)) throw new Error(`Invalid or duplicate target: ${targetId}`);
    const span = typeof row.evidenceId === "string" ? spans.get(row.evidenceId) : undefined;
    if (!span) throw new Error(`Unbound evidence for ${target.id}`);
    if (typeof row.claim !== "string" || !row.claim.trim() || row.claim.length > 400) {
      throw new Error(`Invalid claim for ${target.id}`);
    }
    return {
      targetId: target.id,
      value: normalizeValue(row.value, target),
      claim: row.claim.trim(),
      evidence: {
        sourceHash: fixture.sha256,
        reference: `${fixture.reference}#L${span.start}-L${span.end}`,
        start: span.start,
        end: span.end,
        text: span.text,
        spanId: span.id,
      },
    };
  });
}

export async function compileDocument(
  db: Database,
  fixture: DocumentFixture,
  path: string,
  ask: (input: CompileRequest) => Promise<unknown>,
): Promise<Compilation> {
  const { workId, version, targets } = fixture;
  const spans = await readSpans(fixture, path);
  const inputHash = sha256(JSON.stringify([fixture.sha256, fixture.reference, fixture.spans, targets]));
  const lookup = db.query<{ input_hash: string; claims_json: string }, [string, string]>(
    "SELECT input_hash, claims_json FROM compilations WHERE work_id = ? AND version = ?",
  );

  function replay(): Compilation | undefined {
    const previous = lookup.get(workId, version);
    if (!previous) return;
    if (previous.input_hash !== inputHash) throw new Error(`Source version conflict for ${workId} ${version}`);
    return { workId, version, replayed: true, claims: JSON.parse(previous.claims_json) as BoundClaim[] };
  }

  const previous = replay();
  if (previous) return previous;
  const claims = bindClaims(await ask({ workId, version, targets, spans }), fixture, spans);
  if (claims.length === 0) return { workId, version, replayed: false, claims };
  return db
    .transaction(() => {
      const settled = replay();
      if (settled) return settled;
      db.query("INSERT INTO compilations VALUES (?, ?, ?, ?)").run(workId, version, inputHash, JSON.stringify(claims));
      const atom = db.query("INSERT INTO knowledge VALUES (?, ?, ?) ON CONFLICT DO NOTHING");
      const observation = db.query("INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?)");
      for (const claim of claims) {
        atom.run(workId, claim.targetId, claim.value);
        observation.run(workId, version, claim.targetId, claim.value, claim.claim, JSON.stringify(claim.evidence));
      }
      return { workId, version, replayed: false, claims };
    })
    .immediate();
}

export function inspectCompilerStore(db: Database) {
  return {
    knowledge: db.query("SELECT * FROM knowledge ORDER BY work_id, target_id, value").all(),
    observations: db.query("SELECT * FROM observations ORDER BY work_id, target_id, version").all(),
  };
}
