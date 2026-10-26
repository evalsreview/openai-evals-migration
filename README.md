# openai-evals-migration

Turns an exported OpenAI hosted eval (an Evals API eval JSON plus JSONL items) into a promptfoo config (`promptfooconfig.yaml` + `tests.yaml`), and reports which graders it could not convert.

OpenAI's Evals platform becomes read-only on **31 Oct 2026** and is scheduled to shut down on **30 Nov 2026** ([OpenAI deprecations page](https://developers.openai.com/api/docs/deprecations), checked 26 Oct 2026). OpenAI's [cookbook guide](https://developers.openai.com/cookbook/examples/evaluation/moving-from-openai-evals-to-promptfoo) recommends promptfoo, and describes the migration as recreating the eval by hand. This script does the mechanical part of that.

## Quickstart

```bash
# Node 18+ for the converter (no dependencies)
node convert.mjs --eval eval.json --items items.jsonl --run run.json --out migrated/
cat migrated/MIGRATION_REPORT.txt

# promptfoo needs Node >= 22.22 (v0.125.1). Your key comes from env only:
export OPENAI_API_KEY=...   # never commit it
npx promptfoo@latest validate -c migrated/promptfooconfig.yaml
cd migrated && npx promptfoo@latest eval -c promptfooconfig.yaml --no-cache
```

`--run` is optional. Without it, the tool writes a placeholder prompt and provider and warns you.

An agent skill version is in [`SKILL.md`](SKILL.md).

## Grader mapping

| OpenAI `testing_criteria` type | promptfoo assertion | Notes |
| --- | --- | --- |
| `string_check` `eq` / `ne` / `like` / `ilike` | `equals` / `not-equals` / `contains` / `icontains` | Exact |
| `text_similarity` `cosine` | `similar` | Uses promptfoo's embedding provider, so scores differ |
| `text_similarity` `bleu` / `gleu` / `meteor` | `bleu` / `gleu` / `meteor` | Re-check thresholds |
| `score_model` | `llm-rubric` | `pass_threshold` rescaled from `range` to 0-1. Approximation |
| `label_model` | `llm-rubric` | A pass/fail judge, not a label classifier. Approximation |

**Not converted (listed as UNSUPPORTED in the report):** `python`, `multi`, `endpoint` and any other grader type; `text_similarity` `fuzzy_match` and `rouge_*`; any grader whose input isn't `{{ sample.output_text }}` or whose reference uses `sample.*` fields; and `stored_completions` / logs data sources, which have no items to export.

Sources for the mapping:
- OpenAI Graders guide: https://developers.openai.com/api/docs/guides/graders
- OpenAI Evals API reference: https://developers.openai.com/api/reference/resources/evals
- OpenAI cookbook, moving to promptfoo: https://developers.openai.com/cookbook/examples/evaluation/moving-from-openai-evals-to-promptfoo
- promptfoo assertions: https://www.promptfoo.dev/docs/configuration/expected-outputs/
- promptfoo model-graded (llm-rubric): https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/
- promptfoo configuration: https://www.promptfoo.dev/docs/configuration/guide/

## Example

`examples/sample-export/` holds **synthetic data we made up** to show the export shape. It is not a real OpenAI eval, ID or result. Converting it printed:

```
tests: 3
assertions: 5
WARN close to reference: bleu implementation may differ numerically from OpenAI's; re-check the threshold
WARN helpfulness: score_model range [1, 7] pass_threshold 5 rescaled to llm-rubric threshold 0.6667 (0-1)
WARN helpfulness: score_model -> llm-rubric is an approximation; validate the judge before trusting it
WARN tone: label_model -> llm-rubric is an approximation (pass/fail judge, not a label classifier); validate against old OpenAI results
UNSUPPORTED fuzzy reference: text_similarity metric "fuzzy_match" has no direct promptfoo assertion (map manually)
UNSUPPORTED custom length check: grader type "python" is not converted automatically (python, multi, endpoint and others need manual work)
```

The generated files are in `examples/output/`.

## What we actually tested (26 Oct 2026)

The full log is in [`examples/test-run-2026-10-26.txt`](examples/test-run-2026-10-26.txt). To reproduce it, run `./scripts-run-tests.sh`.

- `node --test tests/`: 8 passed, 0 failed (Node 20.19.2).
- `promptfoo validate -c promptfooconfig.yaml` (promptfoo 0.125.1 on Node 22.23.4): "Configuration is valid." This command checks the config schema only. We confirmed that it accepts an unknown assertion type too.
- Offline smoke run, `promptfoo eval` with the `echo` provider and the `llm-rubric` asserts removed: 3 test cases, 0 errors. They all failed, which is expected because echo returns the prompt and not a real answer. The run shows promptfoo executes the generated `icontains`, `not-equals` and `bleu` assertions. It says nothing about the model's quality.
- **We have not tested** a run against a real OpenAI model, the `llm-rubric` graders, or a comparison with real OpenAI Evals results.

## Limitations

- The tool converts graders and data only. Grader-specific sampling parameters, run history and dashboard results don't carry over.
- Scores from LLM judges and similarity graders won't match OpenAI's numbers. Validate them before you use them to gate regressions.
- The tool doesn't call the OpenAI API. You export the files yourself.

## Licence

MIT, see [LICENSE](LICENSE).

---

Maintained by Evals Review. Homepage: [evalsreview.com](https://evalsreview.com). Guide: [OpenAI Evals](https://evalsreview.com/eval/openai-evals).
