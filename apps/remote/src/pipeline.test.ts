// @warsha/remote — the pipeline plate: where each stage sits relative to the run.
import { describe, expect, it } from 'vitest';

import { isTerminalStatus, PIPELINE_STAGES, stagePosition, stageRows } from './pipeline';

describe('PIPELINE_STAGES', () => {
  it('walks the order the daemon walks, gates included', () => {
    expect(PIPELINE_STAGES.slice(0, 3)).toEqual(['idea', 'gate_a', 'research']);
    expect(PIPELINE_STAGES).toContain('review_qa_security');
    expect(PIPELINE_STAGES[PIPELINE_STAGES.length - 1]).toBe('feedback');
  });
});

describe('stagePosition', () => {
  it('marks what is behind the run, what it is on, and what is still to come', () => {
    expect(stagePosition('idea', 'code')).toBe('done');
    expect(stagePosition('code', 'code')).toBe('running');
    expect(stagePosition('release', 'code')).toBe('todo');
  });

  it('says todo for everything when no run is on the bench', () => {
    expect(stagePosition('idea', null)).toBe('todo');
  });

  it('places a stage that comes before the run first', () => {
    // A gate is a stage like any other: the plate must not treat `gate_a` as a special case.
    expect(stagePosition('idea', 'gate_a')).toBe('done');
    expect(stagePosition('gate_b', 'research')).toBe('todo');
  });
});

describe('stageRows', () => {
  it('returns one row per stage, in order', () => {
    const rows = stageRows('design', 'running');
    expect(rows).toHaveLength(PIPELINE_STAGES.length);
    expect(rows.find((row) => row.stage === 'design')?.position).toBe('running');
    expect(rows.find((row) => row.stage === 'gate_b')?.position).toBe('done');
  });

  it('leaves no stage "running" once the run stopped', () => {
    const rows = stageRows('code', 'completed');
    expect(rows.some((row) => row.position === 'running')).toBe(false);
    expect(rows.find((row) => row.stage === 'code')?.position).toBe('done');
    expect(rows.find((row) => row.stage === 'release')?.position).toBe('todo');
  });

  it('treats a failed run the same way as a completed one: where it stopped is where it stopped', () => {
    const rows = stageRows('gate_c', 'failed');
    expect(rows.find((row) => row.stage === 'gate_c')?.position).toBe('done');
    expect(rows.find((row) => row.stage === 'release')?.position).toBe('todo');
  });
});

describe('isTerminalStatus', () => {
  it('knows the three endings and nothing else', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('paused')).toBe(false);
  });
});
