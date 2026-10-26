#!/usr/bin/env node
// Convert an exported OpenAI hosted eval (Evals API JSON) + JSONL items into a promptfoo config.
// Zero dependencies. Node 18+. No API keys are read or written; promptfoo reads OPENAI_API_KEY from env at run time.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ---------- template conversion ----------
// OpenAI: {{ item.field }} / {{item.field}}  ->  promptfoo (Nunjucks): {{ field }}
// OpenAI: {{ sample.output_text }}           ->  promptfoo llm-rubric sees the output itself; inside
//                                                assertion values we use {{ output }} only where promptfoo supports it.
export function convertTemplate(s) {
  if (typeof s !== "string") return s;
  return s.replace(/\{\{\s*item\.([A-Za-z0-9_.]+)\s*\}\}/g, "{{ $1 }}");
}
const isSampleOutput = (s) => typeof s === "string" && /^\s*\{\{\s*sample\.output_text\s*\}\}\s*$/.test(s);
const mentionsSample = (s) => typeof s === "string" && /\{\{\s*sample\./.test(s);

function messagesText(input) {
  if (typeof input === "string") return convertTemplate(input);
  if (!Array.isArray(input)) return "";
  return input
    .map((m) => {
      const c = typeof m.content === "string" ? m.content : m.content?.text ?? JSON.stringify(m.content);
      return `[${m.role}] ${convertTemplate(c).replace(/\{\{\s*sample\.output_text\s*\}\}/g, "(the model output under test)")}`;
    })
    .join("\n");
}

// ---------- grader mapping ----------
const STRING_OPS = { eq: "equals", ne: "not-equals", like: "contains", ilike: "icontains" };
const SIM_METRICS = { cosine: "similar", bleu: "bleu", gleu: "gleu", meteor: "meteor" };

export function mapCriterion(c) {
  const name = c.name ?? c.type;
  const warn = [];
  switch (c.type) {
    case "string_check": {
      const type = STRING_OPS[c.operation];
      if (!type) return { unsupported: `${name}: string_check operation "${c.operation}" not recognised` };
      if (!isSampleOutput(c.input))
        return { unsupported: `${name}: string_check input "${c.input}" is not {{sample.output_text}}; promptfoo asserts on the output only` };
      if (mentionsSample(c.reference))
        return { unsupported: `${name}: reference uses sample.* fields, which have no promptfoo equivalent` };
      return { assert: { type, value: convertTemplate(c.reference), metric: name }, warn };
    }
    case "text_similarity": {
      const type = SIM_METRICS[c.evaluation_metric];
      if (!type)
        return { unsupported: `${name}: text_similarity metric "${c.evaluation_metric}" has no direct promptfoo assertion (map manually)` };
      if (!isSampleOutput(c.input))
        return { unsupported: `${name}: text_similarity input is not {{sample.output_text}}` };
      if (type === "similar") warn.push(`${name}: cosine -> promptfoo "similar" uses promptfoo's embedding provider; scores will differ from OpenAI's`);
      else warn.push(`${name}: ${c.evaluation_metric} implementation may differ numerically from OpenAI's; re-check the threshold`);
      return { assert: { type, value: convertTemplate(c.reference), threshold: c.pass_threshold, metric: name }, warn };
    }
    case "label_model": {
      const labels = (c.labels ?? []).join(", ");
      const passing = (c.passing_labels ?? []).join(", ");
      const rubric = `${messagesText(c.input)}\n\nAllowed labels: ${labels}. Pass only if the correct label is one of: ${passing}.`;
      warn.push(`${name}: label_model -> llm-rubric is an approximation (pass/fail judge, not a label classifier); validate against old OpenAI results`);
      const a = { type: "llm-rubric", value: rubric, metric: name };
      if (c.model) a.provider = `openai:chat:${c.model}`;
      return { assert: a, warn };
    }
    case "score_model": {
      const range = c.range ?? [0, 1];
      const a = { type: "llm-rubric", value: messagesText(c.input), metric: name };
      if (typeof c.pass_threshold === "number") {
        const [lo, hi] = range;
        a.threshold = Number(((c.pass_threshold - lo) / (hi - lo)).toFixed(4));
        warn.push(`${name}: score_model range [${lo}, ${hi}] pass_threshold ${c.pass_threshold} rescaled to llm-rubric threshold ${a.threshold} (0-1)`);
      }
      warn.push(`${name}: score_model -> llm-rubric is an approximation; validate the judge before trusting it`);
      if (c.model) a.provider = `openai:chat:${c.model}`;
      return { assert: a, warn };
    }
    default:
      return { unsupported: `${name}: grader type "${c.type}" is not converted automatically (python, multi, endpoint and others need manual work)` };
  }
}

// ---------- items ----------
export function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l, i) => {
      const o = JSON.parse(l);
      if (o && typeof o === "object" && o.item && typeof o.item === "object") return o.item;
      if (o && typeof o === "object") return o;
      throw new Error(`line ${i + 1}: not a JSON object`);
    });
}

// ---------- tiny YAML emitter (JSON-quoted scalars are valid YAML) ----------
function yaml(v, ind = "") {
  if (Array.isArray(v)) {
    if (!v.length) return " []";
    return v.map((x) => `\n${ind}- ${yaml(x, ind + "  ").replace(/^\n\s*/, "")}`).join("");
  }
  if (v && typeof v === "object") {
    const ks = Object.keys(v).filter((k) => v[k] !== undefined);
    if (!ks.length) return " {}";
    return ks.map((k) => {
      const val = v[k];
      const inner = yaml(val, ind + "  ");
      return `\n${ind}${k}:${val && typeof val === "object" ? inner : " " + inner.trim()}`;
    }).join("");
  }
  return JSON.stringify(v);
}
export const toYaml = (v) => yaml(v).replace(/^\n/, "") + "\n";

// ---------- main conversion ----------
export function convert({ evalObj, items, run }) {
  if (evalObj?.object && evalObj.object !== "eval") throw new Error(`expected object "eval", got "${evalObj.object}"`);
  const criteria = evalObj.testing_criteria ?? [];
  const asserts = [], warnings = [], unsupported = [];
  for (const c of criteria) {
    const r = mapCriterion(c);
    if (r.unsupported) unsupported.push(r.unsupported);
    else { asserts.push(r.assert); warnings.push(...r.warn); }
  }
  const dsType = evalObj.data_source_config?.type;
  if (dsType && dsType !== "custom") warnings.push(`data_source_config.type "${dsType}": items are used as-is; check fields (stored_completions/logs sources are not exported by this tool)`);

  let prompts, providers;
  const tmpl = run?.data_source?.input_messages?.template;
  if (Array.isArray(tmpl)) {
    const msgs = tmpl.map((m) => ({ role: m.role, content: convertTemplate(typeof m.content === "string" ? m.content : m.content?.text ?? "") }));
    prompts = [{ raw: JSON.stringify(msgs), label: evalObj.name ?? "migrated-prompt" }];
  } else {
    warnings.push("No run file with data_source.input_messages.template: wrote a placeholder prompt; replace it with your real prompt");
    prompts = ["TODO replace with your prompt. Variables available: " + Object.keys(items[0] ?? {}).map((k) => `{{ ${k} }}`).join(" ")];
  }
  const model = run?.data_source?.model;
  if (model) providers = [`openai:chat:${model}`];
  else { providers = ["openai:chat:REPLACE_WITH_YOUR_MODEL"]; warnings.push("No model found in run file: set providers manually"); }

  const config = {
    description: `Migrated from OpenAI eval ${evalObj.id ?? ""} ${evalObj.name ?? ""}`.replace(/\s+/g, " ").trim(),
    prompts,
    providers,
    defaultTest: { assert: asserts },
    tests: "file://tests.yaml",
  };
  const tests = items.map((vars, i) => ({ description: `item ${i + 1}`, vars }));
  return { config, tests, warnings, unsupported };
}

// ---------- CLI ----------
function cli(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[++i];
  if (!args.eval || !args.items || !args.out) {
    console.error("usage: node convert.mjs --eval eval.json --items items.jsonl [--run run.json] --out outdir");
    process.exit(2);
  }
  const evalObj = JSON.parse(readFileSync(args.eval, "utf8"));
  const items = parseJsonl(readFileSync(args.items, "utf8"));
  const run = args.run ? JSON.parse(readFileSync(args.run, "utf8")) : undefined;
  const { config, tests, warnings, unsupported } = convert({ evalObj, items, run });
  mkdirSync(args.out, { recursive: true });
  const header = "# Generated by openai-evals-migration (convert.mjs). Review before use.\n# Requires OPENAI_API_KEY in your environment at run time. Never commit keys.\n";
  writeFileSync(join(args.out, "promptfooconfig.yaml"), header + toYaml(config));
  writeFileSync(join(args.out, "tests.yaml"), header + toYaml(tests));
  const report = [`tests: ${tests.length}`, `assertions: ${config.defaultTest.assert.length}`,
    ...warnings.map((w) => `WARN ${w}`), ...unsupported.map((u) => `UNSUPPORTED ${u}`)].join("\n") + "\n";
  writeFileSync(join(args.out, "MIGRATION_REPORT.txt"), report);
  process.stdout.write(report);
}
if (import.meta.url === `file://${process.argv[1]}`) cli(process.argv.slice(2));
