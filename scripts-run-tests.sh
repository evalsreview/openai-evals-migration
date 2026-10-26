#!/usr/bin/env bash
# Reproduces examples/test-run-*.txt. Needs Node 20+ for unit tests; promptfoo needs Node >=22.22.
set -u
PF="npx -y promptfoo@latest"; [ -n "${PROMPTFOO_CMD:-}" ] && PF="$PROMPTFOO_CMD"
export PROMPTFOO_DISABLE_TELEMETRY=1
echo "## date: $(date -Iseconds)"; echo "## node: $(node --version)"
echo; echo '$ node --test tests/'; node --test tests/ 2>&1 | grep -E '^(ok|not ok|# (tests|pass|fail))'
echo; echo '$ node convert.mjs --eval examples/sample-export/eval.json --items examples/sample-export/items.jsonl --run examples/sample-export/run.json --out examples/output'
node convert.mjs --eval examples/sample-export/eval.json --items examples/sample-export/items.jsonl --run examples/sample-export/run.json --out examples/output
echo; echo '$ promptfoo --version'; (cd examples/output && env -u OPENAI_API_KEY $PF --version 2>&1 | tail -1)
echo; echo '$ promptfoo validate -c promptfooconfig.yaml'; (cd examples/output && env -u OPENAI_API_KEY $PF validate -c promptfooconfig.yaml 2>&1 | tail -3)
echo; echo '## Offline smoke eval: same tests, echo provider, llm-rubric asserts removed (they need an API key).'
echo '## The echo provider returns the prompt, so most asserts are EXPECTED to fail; this only proves promptfoo accepts and executes the assertion types.'
node -e '
const fs=require("fs");let y=fs.readFileSync("examples/output/promptfooconfig.yaml","utf8");
y=y.replace(/providers:\n  - "[^"]+"/,"providers:\n  - \"echo\"").replace(/    - type: "llm-rubric"[\s\S]*?(?=\n    - type|\ntests:)/g,"");
fs.writeFileSync("/tmp/pf-offline.yaml",y);'
cp examples/output/tests.yaml /tmp/tests.yaml
echo '$ promptfoo eval -c /tmp/pf-offline.yaml --no-cache --no-write'
(cd /tmp && env -u OPENAI_API_KEY $PF eval -c pf-offline.yaml --no-cache --no-write --no-table 2>&1 | grep -vE '^\s*$' | tail -15)
