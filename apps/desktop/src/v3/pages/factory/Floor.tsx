import React from 'react';

import type { AgentStatus } from './state';
import { idleMsOf } from './state';

/**
 * E3 Factory floor schematic (plan §8): SVG + CSS only — stations drawn as
 * rects, agent movement by transform/opacity transitions. No canvas, no game
 * engine. Reduced-motion disables every transition.
 */

export interface FloorProps {
  agents: AgentStatus[];
  nowMs: number;
  reducedMotion: boolean;
  onSelect: (key: string) => void;
  selectedKey: string | null;
  /** Swarm subtask counts per run (D5) — one banner per swarm run. */
  swarmCounts: Map<string, number>;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

interface Station {
  key: string;
  labelKey: string;
  x: number;
  width: number;
  stages: string[];
}

const STATIONS: Station[] = [
  {
    key: 'planning',
    labelKey: 'factory.stations.planning',
    x: 30,
    width: 160,
    stages: ['idea', 'research', 'prd_spec', 'design', 'plan_tasks'],
  },
  {
    key: 'code',
    labelKey: 'factory.stations.code',
    x: 230,
    width: 190,
    stages: ['code', 'feedback'],
  },
  {
    key: 'review',
    labelKey: 'factory.stations.review',
    x: 460,
    width: 150,
    stages: ['review_qa_security'],
  },
  {
    key: 'gates',
    labelKey: 'factory.stations.gates',
    x: 650,
    width: 150,
    stages: ['gate_a', 'gate_b', 'gate_c', 'gate_d'],
  },
  {
    key: 'shipping',
    labelKey: 'factory.stations.shipping',
    x: 840,
    width: 130,
    stages: ['release', 'launch_drafts'],
  },
];

const BREAK_AREA = { x: 30, width: 160, y: 210 };
const AGENT_RADIUS = 11;
const PER_ROW = 6;

function stationOf(agent: AgentStatus): Station | null {
  const byStage = STATIONS.find((station) => station.stages.includes(agent.stage ?? ''));
  if (byStage !== undefined) return byStage;
  if (agent.state === 'done') return STATIONS[STATIONS.length - 1];
  if (agent.state === 'waiting_on_owner') return STATIONS[3];
  if (agent.state === 'working') return STATIONS[1];
  return null;
}

/** Marker position: station slot, break area for idlers, mid-point for handoffs. */
export function markerPosition(
  agent: AgentStatus,
  index: number,
  all: AgentStatus[]
): { x: number; y: number; stationKey: string | null } {
  if (agent.state === 'idle') {
    const row = Math.floor(index / PER_ROW);
    return {
      x: BREAK_AREA.x + 30 + (index % PER_ROW) * 22,
      y: BREAK_AREA.y + row * 26,
      stationKey: null,
    };
  }
  if (agent.state === 'handing_off' && agent.handoffFrom !== null) {
    const source = all.find((candidate) => candidate.key === agent.handoffFrom);
    const sourceStation = source !== undefined ? stationOf(source) : null;
    const target = stationOf(agent);
    const left = sourceStation?.x ?? STATIONS[1].x;
    const right = target?.x ?? STATIONS[3].x;
    return { x: (left + right) / 2, y: 120, stationKey: null };
  }
  const station = stationOf(agent);
  if (station === null) return { x: 500, y: 120, stationKey: null };
  const slot = index % PER_ROW;
  const row = Math.floor(index / PER_ROW);
  return { x: station.x + 22 + slot * 22, y: 120 + row * 26, stationKey: station.key };
}

export const Floor: React.FC<FloorProps> = ({
  agents,
  nowMs,
  reducedMotion,
  onSelect,
  selectedKey,
  swarmCounts,
  t,
}) => {
  const className = reducedMotion ? 'factory-floor factory-floor--reduced' : 'factory-floor';
  return (
    <div
      className={className}
      data-testid="factory-floor"
      role="img"
      aria-label={t('factory.title')}
    >
      <svg
        viewBox="0 0 1000 300"
        className="factory-floor__svg"
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        {STATIONS.map((station) => (
          <g key={station.key}>
            <rect
              x={station.x}
              y={70}
              width={station.width}
              height={110}
              rx="8"
              fill="var(--w-sunken)"
              stroke="var(--w-line)"
            />
            <text
              x={station.x + station.width / 2}
              y={60}
              textAnchor="middle"
              fontSize="14"
              fill="var(--w-text)"
            >
              {t(station.labelKey)}
            </text>
          </g>
        ))}
        <rect
          x={BREAK_AREA.x}
          y={BREAK_AREA.y - 14}
          width={BREAK_AREA.width}
          height={80}
          rx="8"
          fill="var(--w-sunken)"
          stroke="var(--w-line)"
          strokeDasharray="6 4"
        />
        <text
          x={BREAK_AREA.x + BREAK_AREA.width / 2}
          y={BREAK_AREA.y - 22}
          textAnchor="middle"
          fontSize="13"
          fill="var(--w-text-muted)"
        >
          {t('factory.idle')}
        </text>
        {Array.from(swarmCounts.entries())
          .filter(([, count]) => count > 0)
          .map(([runId, count]) => (
            <text
              key={runId}
              x={STATIONS[1].x + 10}
              y={32}
              fontSize="12"
              fill="var(--w-text-muted)"
              data-testid={`factory-swarm-${runId}`}
            >
              {t('factory.swarm_banner', { count, run: runId })}
            </text>
          ))}
        {agents.map((agent, index) => {
          const position = markerPosition(agent, index, agents);
          const selected = agent.key === selectedKey;
          const fill =
            agent.state === 'waiting_on_owner'
              ? 'var(--w-warning)'
              : agent.state === 'done'
                ? 'var(--w-success)'
                : agent.state === 'handing_off'
                  ? 'var(--w-info)'
                  : 'var(--w-primary)';
          return (
            <g
              key={agent.key}
              transform={`translate(${position.x}, ${position.y})`}
              style={{
                cursor: 'pointer',
                transition: reducedMotion ? 'none' : 'transform 300ms ease, opacity 300ms ease',
              }}
              onClick={() => onSelect(agent.key)}
              data-action="factory.agent.view"
              data-testid={`factory-agent-${agent.key}`}
            >
              <circle
                r={AGENT_RADIUS}
                fill={fill}
                stroke={selected ? 'var(--w-text)' : 'var(--w-line)'}
                strokeWidth={selected ? 3 : 1}
              />
              <text y={4} textAnchor="middle" fontSize="9" fill="var(--w-text-on-accent)">
                {(agent.role ?? '?').slice(0, 3)}
              </text>
              {agent.state === 'waiting_on_owner' && (
                <text
                  y={-AGENT_RADIUS - 6}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--w-warning)"
                  data-testid="factory-needs-you"
                >
                  {t('factory.needsYou')}
                </text>
              )}
              {agent.state === 'idle' && (
                <text
                  y={-AGENT_RADIUS - 6}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--w-text-muted)"
                >
                  {t('factory.idleDuration', {
                    duration: Math.round(idleMsOf(agent, nowMs) / 1000),
                  })}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};
