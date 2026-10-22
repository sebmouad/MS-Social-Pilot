#!/bin/bash
# runner.sh <kind:cx|cl> <config-dir> <busy-lane-to-wait-for>
S=/private/tmp/claude-501/-Users-mouad-Documents-ChatGPT-MS-Social-Pilot/d16b3cd0-991c-4f7e-adce-456d9a84beea/scratchpad
Q=$S/queue; P=$S/briefs; L=$S/logs; APP="/Users/mouad/Documents/ChatGPT/MS Social Pilot/app"
C=/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex
T="Read,Edit,Write,Glob,Grep,Skill,Bash(npx tsc:*),Bash(npx vitest:*),Bash(git diff:*),Bash(git status:*),Bash(git log:*),Bash(ls:*),Bash(grep:*),Bash(find:*),Bash(cat:*),Bash(head:*),Bash(sed -n:*),Bash(wc:*)"
kind=$1; cfg=$2; busy=$3
while pgrep -f "msp-$busy" >/dev/null; do sleep 30; done
while true; do
  next=$(ls $Q/todo 2>/dev/null | sort | head -1)
  if [ -z "$next" ]; then sleep 60; continue; fi
  mv "$Q/todo/$next" "$Q/running/$next" 2>/dev/null || continue
  lane=q-${next%.md}; W=/private/tmp/msp-$lane
  (cd "$APP" && rm -rf $W && git worktree prune && git worktree add -q -f $W HEAD && ln -s "$APP/node_modules" $W/node_modules && ln -s "$APP/rebuild/node_modules" $W/rebuild/node_modules && cd $W/rebuild && npx prisma generate >/dev/null 2>&1; cp $S/pending/*.patch $W/ 2>/dev/null)
  if [ "$kind" = cx ]; then (cd $W && CODEX_HOME=$cfg $C exec -s workspace-write --skip-git-repo-check "$(cat $P/_common.md $Q/running/$next)" > $L/$lane.log 2>&1)
  elif [ "$kind" = mu ]; then (cd $W && $MUSE exec --workspace $W --trust-workspace --approval-mode never "$(cat $P/_common.md $Q/running/$next)" > $L/$lane.log 2>&1)
  else (cd $W && cat $P/_common.md $Q/running/$next | CLAUDE_CONFIG_DIR=$cfg ~/.local/bin/claude -p --model sonnet --permission-mode acceptEdits --allowedTools "$T" > $L/$lane.log 2>&1); fi
  if grep -q "out of credits" $L/$lane.log; then mv "$Q/running/$next" "$Q/todo/$next"; echo "$(date +%H:%M) $lane NO-CREDITS ($cfg)" >> $Q/finished.log; sleep 1800; continue; fi
  echo "$(date +%H:%M) $lane exit $? ($cfg)" >> $Q/finished.log
  mv "$Q/running/$next" "$Q/done/$next"
done
