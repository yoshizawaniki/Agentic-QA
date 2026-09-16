import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../src/util/schema.ts";
import type { Schema } from "../src/util/schema.ts";

const objSchema: Schema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 2 },
    level: { type: "number", minimum: 0 },
    kind: { type: "string", enum: ["a", "b"] as readonly string[] },
    tags: { type: "array", items: { type: "string" } },
    nested: {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
    },
  },
  required: ["name"],
};

test("schema: accepts valid object", () => {
  const errs = validate(objSchema, { name: "x1", level: 3, kind: "a", tags: ["t"], nested: { ok: true } });
  assert.deepEqual(errs, []);
});

test("schema: reports missing required field", () => {
  const errs = validate(objSchema, {});
  assert.ok(errs.some((e) => e.includes("name") && e.includes("missing")));
});

test("schema: reports enum violation", () => {
  const errs = validate(objSchema, { name: "abc", kind: "z" });
  assert.ok(errs.some((e) => e.includes("kind")));
});

test("schema: reports type violations with paths", () => {
  const errs = validate(objSchema, { name: 5, nested: { ok: "yes" } });
  assert.ok(errs.some((e) => e.includes("$.name")));
  assert.ok(errs.some((e) => e.includes("$.nested.ok")));
});

test("schema: array element errors indexed", () => {
  const errs = validate(objSchema, { name: "ok", tags: ["fine", 42] });
  assert.ok(errs.some((e) => e.includes("$.tags[1]")));
});
