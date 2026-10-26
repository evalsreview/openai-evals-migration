---
name: openai-evals-migration
description: Use when someone needs to move an OpenAI hosted eval (Evals API or dashboard) to promptfoo before the OpenAI Evals platform shutdown. It converts the eval JSON and JSONL items into promptfooconfig.yaml and tests.yaml, then reports which graders need manual work.
---

# Migrate an OpenAI hosted eval to promptfoo

## Deadline

OpenAI's deprecations page (https://developers.openai.com/api/docs/deprecations, checked 26 Oct 2026) lists these dates:
- 3 Jun 2026: deprecation announced.
- 31 Oct 2026: existing evals become read-only.
- 30 Nov 2026: the Evals dashboard and API are scheduled to shut down.

Export before 30 Nov 2026. After 31 Oct you can still read the evals, but you can't edit them.

## When to use

- The user has evals in OpenAI's Evals product and wants them in promptfoo, which OpenAI's cookbook recommends.
- The user has an eval object (`GET /v1/evals/{id}`), its items as JSONL, and optionally one run (`GET /v1/evals/{id}/runs/{run_id}`), which holds the prompt template and model.

## Steps

1. Export with the user's own key, which you read from the environment and never write to a file:
   - `curl -s https://api.openai.com/v1/evals/$EVAL_ID -H "Authorization: Bearer $OPENAI_API_KEY" > eval.json`
   - Save a run the same way as `run.json`.
   - Save the dataset rows as `items.jsonl`, one `{"item": {...}}` or one bare object per line.
2. Convert: `node convert.mjs --eval eval.json --items items.jsonl --run run.json --out migrated/`
3. Read `migrated/MIGRATION_REPORT.txt`. Every `UNSUPPORTED` line has to be recreated by hand, and every `WARN` line has to be checked.
4. Validate: `npx promptfoo@latest validate -c migrated/promptfooconfig.yaml`. This needs Node 22.22 or later. Note that validate checks the schema only, not assertion types.
5. Run: `cd migrated && npx promptfoo@latest eval -c promptfooconfig.yaml --no-cache`, then `promptfoo view`.
6. Compare pass rates with the last OpenAI run before relying on the migrated eval. LLM-judge and similarity scores won't match exactly.

## Mapping

| OpenAI grader | promptfoo |
| --- | --- |
| string_check eq / ne / like / ilike | equals / not-equals / contains / icontains |
| text_similarity cosine | similar (threshold = pass_threshold) |
| text_similarity bleu / gleu / meteor | bleu / gleu / meteor (threshold = pass_threshold) |
| score_model | llm-rubric (threshold rescaled to 0-1 from range) |
| label_model | llm-rubric (approximation) |
| python, multi, endpoint, fuzzy_match, rouge_*, others | not converted; listed in the report |

In templates, `{{ item.x }}` becomes `{{ x }}`. Graders whose input isn't `{{ sample.output_text }}` are reported as unsupported.
