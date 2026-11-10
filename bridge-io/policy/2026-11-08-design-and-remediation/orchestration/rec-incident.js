const fs=require('fs');
const dir='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/';
const now=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const s=JSON.parse(fs.readFileSync(dir+'state.json','utf8'));
if(s.seq!==48){console.error('seq '+s.seq);process.exit(1);}
s.seq=49;s.updated_at=now;
s.orchestration_findings.push({
  at:now,
  topic:'INCIDENT (self-inflicted, contained): backticks inside node -e "..." were executed by bash; no repository damage',
  fact:'While rewriting OWNER_DECISIONS.md I embedded markdown backticks inside a double-quoted `node -e "..."` argument. Bash command-substituted every backticked fragment, so stray commands ran: a `git merge` against a malformed ref (which FAILED - "not something we can merge"), two `mdbook` invocations with malformed subcommands (both FAILED), and several "command not found". It also mangled the document itself, dropping every backticked token (4452 bytes of corrupted text). IMMEDIATE VERIFICATION OF DAMAGE: dev still 642ae95 with its log ending there, integration still e172caf, no MERGE_HEAD present, dev checkout 0 dirty files, integration worktree 0 dirty files - so nothing was merged, committed, checked out or deleted. The document was then recreated with the file tool (5243 bytes, 106 backticks intact, 89 lines, all five OD ids present). This is the exact hazard already recorded in my own notes ("backticks inside bash -c get substituted") and I still walked into it; the lesson is to write documents with the file tool, never through a shell-quoted node one-liner.'
});
fs.writeFileSync(dir+'state.json',JSON.stringify(s,null,2)+'\n');
fs.writeFileSync(dir+'checkpoints/049-incident.json',JSON.stringify(s,null,2)+'\n');
console.log('seq='+s.seq+' incident recorded; docs verified');
