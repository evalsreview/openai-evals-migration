import { test } from "node:test";
import assert from "node:assert/strict";
import { convertTemplate, mapCriterion, parseJsonl, convert, toYaml } from "../convert.mjs";

test("item templates become promptfoo vars", () => {
  assert.equal(convertTemplate("Q: {{ item.question }} / {{item.a.b}}"), "Q: {{ question }} / {{ a.b }}");
});

test("string_check operations map to promptfoo assertions", () => {
  const base = { type: "string_check", input: "{{ sample.output_text }}", reference: "{{ item.x }}" };
  assert.equal(mapCriterion({ ...base, operation: "eq" }).assert.type, "equals");
  assert.equal(mapCriterion({ ...base, operation: "ne" }).assert.type, "not-equals");
  assert.equal(mapCriterion({ ...base, operation: "like" }).assert.type, "contains");
  assert.equal(mapCriterion({ ...base, operation: "ilike" }).assert.type, "icontains");
  assert.equal(mapCriterion({ ...base, operation: "eq" }).assert.value, "{{ x }}");
});

test("string_check on a non-output input is flagged unsupported", () => {
  const r = mapCriterion({ type: "string_check", input: "{{ item.x }}", operation: "eq", reference: "a" });
  assert.ok(r.unsupported);
});

test("text_similarity maps known metrics with threshold, flags others", () => {
  const r = mapCriterion({ type: "text_similarity", input: "{{sample.output_text}}", reference: "r", evaluation_metric: "cosine", pass_threshold: 0.8 });
  assert.deepEqual([r.assert.type, r.assert.threshold], ["similar", 0.8]);
  assert.ok(mapCriterion({ type: "text_similarity", input: "{{sample.output_text}}", reference: "r", evaluation_metric: "fuzzy_match" }).unsupported);
});

test("score_model rescales threshold into 0-1 llm-rubric", () => {
  const r = mapCriterion({ type: "score_model", input: [{ role: "user", content: "{{ item.q }} {{ sample.output_text }}" }], range: [1, 7], pass_threshold: 4 });
  assert.equal(r.assert.type, "llm-rubric");
  assert.equal(r.assert.threshold, 0.5);
  assert.match(r.assert.value, /\{\{ q \}\}/);
});

test("python/multi graders are reported unsupported", () => {
  assert.ok(mapCriterion({ type: "python", source: "x" }).unsupported);
  assert.ok(mapCriterion({ type: "multi" }).unsupported);
});

test("jsonl accepts wrapped and bare items", () => {
  assert.deepEqual(parseJsonl('{"item":{"a":1}}\n\n{"a":2}\n'), [{ a: 1 }, { a: 2 }]);
});

test("convert builds config, tests and placeholder warnings without a run", () => {
  const out = convert({ evalObj: { object: "eval", testing_criteria: [] }, items: [{ a: 1 }] });
  assert.equal(out.tests.length, 1);
  assert.ok(out.warnings.some((w) => w.includes("placeholder prompt")));
  assert.ok(toYaml(out.config).includes('tests: "file://tests.yaml"'));
});
