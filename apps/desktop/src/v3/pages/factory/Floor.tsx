import React from 'react';

import type { AgentStatus } from './state';
import { idleMsOf } from './state';

/**
 * E3 Factory floor schematic (plan §8): SVG + CSS only — stations drawn as
 * rects, agent movement by transform/opacity transitions. No canvas, no game
 * engine. Reduced-motion disables every transition.
 *
 * Coordinates are logical (inline-start = 0). In RTL the floor is mirrored at
 * render time so work flows right → left like the rest of the Arabic UI; the
 * text itself is never flipped.
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
  /** Layout direction of the surrounding UI; the floor mirrors in RTL. */
  dir?: 'ltr' | 'rtl';
}

export interface Station {
  key: string;
  labelKey: string;
  x: number;
  width: number;
  stages: string[];
}

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 316;
const STATION_TOP = 66;
const STATION_HEIGHT = 110;
const STATION_LABEL_Y = 52;
const WORK_ROW_Y = 120;

export const STATIONS: Station[] = [
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
    // 152 wide, not 130: six markers of diameter 22 need a slot pitch of at
    // least 24 across the 16-unit insets, and (130 - 32) / 5 = 19.6 overlapped
    // five pairs on a release crew. The extra width comes out of the gutter to
    // Your decisions, so the floor keeps its 30-unit outer margins.
    x: 818,
    width: 152,
    stages: ['release', 'launch_drafts'],
  },
];

/**
 * The break area sits under the planning station with a clear gutter: its
 * label baseline is 36 units below the station row (GUI re-test 3 saw the old
 * label touch the station's bottom edge) and its box starts under the label.
 * `y` is the first idler row.
 */
const BREAK_AREA = { x: 30, width: 160, y: 258 };
const BREAK_BOX_TOP = BREAK_AREA.y - 36;
const BREAK_BOX_HEIGHT = 82;
const BREAK_LABEL_Y = BREAK_AREA.y - 46;
export const AGENT_RADIUS = 11;
const PER_ROW = 6;
/** Inset so a marker circle stays inside its station box. */
const SLOT_INSET = 16;
/** Next row starts below the marker, under the shared station caption. */
const ROW_GAP = 36;

/**
 * A marker is 2 * AGENT_RADIUS across; two units of air keep neighbours from
 * touching even at the narrowest station. No station may undercut this pitch.
 */
const MIN_SLOT_PITCH = AGENT_RADIUS * 2 + 2;

/**
 * Gap between co-stationed markers. Sized from the station so a full row
 * stays inside the box, but never below one marker diameter plus air — a
 * narrow station spills its row rather than overlapping it. The "Needs you"
 * caption is painted once per station group, not once per marker, so this gap
 * does not have to clear that string.
 */
function slotGap(stationWidth: number): number {
  return Math.max(MIN_SLOT_PITCH, (stationWidth - SLOT_INSET * 2) / (PER_ROW - 1));
}

/**
 * First slot of a row: the inset, or the centred start of a floored row that
 * overflows it.
 */
function slotStart(station: Station, gap: number): number {
  const span = (PER_ROW - 1) * gap;
  return station.x + Math.max(SLOT_INSET, (station.width - span) / 2);
}

function stationCenter(stationKey: string): number {
  const station = STATIONS.find((candidate) => candidate.key === stationKey);
  if (station === undefined) return VIEW_WIDTH / 2;
  return station.x + station.width / 2;
}

function stationOf(agent: AgentStatus): Station | null {
  const byStage = STATIONS.find((station) => station.stages.includes(agent.stage ?? ''));
  if (byStage !== undefined) return byStage;
  if (agent.state === 'done') return STATIONS[STATIONS.length - 1];
  if (agent.state === 'waiting_on_owner') return STATIONS[3];
  if (agent.state === 'working') return STATIONS[1];
  return null;
}

/** Marker position (logical, LTR): station slot, break area for idlers, mid-point for handoffs. */
export function markerPosition(
  agent: AgentStatus,
  index: number,
  all: AgentStatus[]
): { x: number; y: number; stationKey: string | null } {
  if (agent.state === 'idle') {
    const idleBefore = all
      .slice(0, index + 1)
      .filter((candidate) => candidate.state === 'idle').length;
    const idleSlot = Math.max(0, idleBefore - 1);
    const row = Math.floor(idleSlot / PER_ROW);
    return {
      x: BREAK_AREA.x + 30 + (idleSlot % PER_ROW) * 22,
      y: BREAK_AREA.y + row * 26,
      stationKey: null,
    };
  }
  if (agent.state === 'handing_off' && agent.handoffFrom !== null) {
    const source = all.find((candidate) => candidate.key === agent.handoffFrom);
    const sourceStation = source !== undefined ? stationOf(source) : null;
    const target = stationOf(agent);
    const from = sourceStation?.x ?? STATIONS[1].x;
    const to = target?.x ?? STATIONS[3].x;
    return { x: (from + to) / 2, y: WORK_ROW_Y, stationKey: null };
  }
  const station = stationOf(agent);
  if (station === null) return { x: VIEW_WIDTH / 2, y: WORK_ROW_Y, stationKey: null };
  // Slot by who already stands at this station, not by the global array index.
  // A shared index stacked six gate waits on one point.
  const here = all.filter(
    (candidate, candidateIndex) =>
      candidateIndex <= index &&
      candidate.state !== 'idle' &&
      candidate.state !== 'handing_off' &&
      stationOf(candidate)?.key === station.key
  );
  const slotIndex = here.length - 1;
  const slot = slotIndex % PER_ROW;
  const row = Math.floor(slotIndex / PER_ROW);
  const gap = slotGap(station.width);
  return {
    x: slotStart(station, gap) + slot * gap,
    y: WORK_ROW_Y + row * ROW_GAP,
    stationKey: station.key,
  };
}

/**
 * One "Needs you" caption per station group, not one per marker.
 *
 * A middle-anchored caption on every co-stationed marker is wider than any
 * gap that still fits six circles inside the station box, so the copies paint
 * on top of each other and the last one runs off the floor. The caption is
 * drawn once, centered on the group, and every later marker returns false.
 */
export function showsNeedsYou(agent: AgentStatus, index: number, all: AgentStatus[]): boolean {
  if (agent.state !== 'waiting_on_owner') return false;
  const stationKey = stationOf(agent)?.key ?? null;
  for (let earlier = 0; earlier < index; earlier += 1) {
    const candidate = all[earlier];
    if (candidate.state !== 'waiting_on_owner') continue;
    if ((stationOf(candidate)?.key ?? null) === stationKey) return false;
  }
  return true;
}

/** Short role mark painted inside a marker. Catalog short labels, never a slice of the role id. */
export function markerRoleKey(role: string | null): string {
  if (role === null || role.length === 0) return 'factory.panel.unknown';
  return `factory.role.${role}`;
}

/** Status → marker colours: soft fill, strong outline, readable ink — the same pairing chips use. */
function markerColours(state: AgentStatus['state']): { fill: string; stroke: string; ink: string } {
  switch (state) {
    case 'waiting_on_owner':
      return { fill: 'var(--w-attention-soft)', stroke: 'var(--w-attention)', ink: 'var(--w-attention)' };
    case 'done':
      return { fill: 'var(--w-success-soft)', stroke: 'var(--w-success)', ink: 'var(--w-success)' };
    case 'handing_off':
      return { fill: 'var(--w-info-soft)', stroke: 'var(--w-info)', ink: 'var(--w-info)' };
    case 'idle':
      return { fill: 'var(--w-surface)', stroke: 'var(--w-line-strong)', ink: 'var(--w-text-muted)' };
    default:
      return { fill: 'var(--w-primary-soft)', stroke: 'var(--w-primary-text)', ink: 'var(--w-primary-text)' };
  }
}

export const Floor: React.FC<FloorProps> = ({
  agents,
  nowMs,
  reducedMotion,
  onSelect,
  selectedKey,
  swarmCounts,
  t,
  dir = 'ltr',
}) => {
  const rtl = dir === 'rtl';
  /** Mirror a logical point / box start into the drawn coordinate. */
  const px = (x: number): number => (rtl ? VIEW_WIDTH - x : x);
  const boxX = (x: number, width: number): number => (rtl ? VIEW_WIDTH - x - width : x);
  const className = reducedMotion ? 'factory-floor factory-floor--reduced' : 'factory-floor';
  const transition = reducedMotion
    ? 'none'
    : 'transform var(--w-dur-slow) var(--w-ease), opacity var(--w-dur-slow) var(--w-ease)';
  const selectedAgent = selectedKey === null ? undefined : agents.find((a) => a.key === selectedKey);
  const idleAgents = agents.filter((a) => a.state === 'idle');
  const idleCaptionAgent =
    selectedAgent?.state === 'idle'
      ? selectedAgent
      : idleAgents.reduce<AgentStatus | undefined>(
          (longest, candidate) =>
            longest === undefined || idleMsOf(candidate, nowMs) > idleMsOf(longest, nowMs)
              ? candidate
              : longest,
          undefined
        );

  return (
    <div className={className} data-testid="factory-floor" role="img" aria-label={t('factory.title')}>
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} className="factory-floor__svg" direction="ltr">
        {STATIONS.map((station) => (
          <g key={station.key}>
            <rect
              x={boxX(station.x, station.width)}
              y={STATION_TOP}
              width={station.width}
              height={STATION_HEIGHT}
              rx="10"
              fill="var(--w-sunken)"
              stroke="var(--w-line)"
            />
            <text
              x={px(station.x + station.width / 2)}
              y={STATION_LABEL_Y}
              textAnchor="middle"
              fontSize="14"
              fontWeight={600}
              fill="var(--w-text)"
            >
              {t(station.labelKey)}
            </text>
          </g>
        ))}
        <rect
          x={boxX(BREAK_AREA.x, BREAK_AREA.width)}
          y={BREAK_BOX_TOP}
          width={BREAK_AREA.width}
          height={BREAK_BOX_HEIGHT}
          rx="10"
          fill="var(--w-bg)"
          stroke="var(--w-line-strong)"
          strokeDasharray="6 4"
        />
        <text
          x={px(BREAK_AREA.x + BREAK_AREA.width / 2)}
          y={BREAK_LABEL_Y}
          textAnchor="middle"
          fontSize="13"
          fill="var(--w-text-muted)"
          data-testid="factory-break-label"
        >
          {t('factory.idle')}
        </text>
        {Array.from(swarmCounts.entries())
          .filter(([, count]) => count > 0)
          .map(([runId, count], index) => (
            <text
              key={runId}
              x={px(STATIONS[1].x + 10)}
              y={20 + index * 14}
              textAnchor={rtl ? 'end' : 'start'}
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
          const colours = markerColours(agent.state);
          return (
            <g
              key={agent.key}
              transform={`translate(${px(position.x)}, ${position.y})`}
              className="factory-floor__agent"
              style={{ transition }}
              onClick={() => onSelect(agent.key)}
              data-action="factory.agent.view"
              data-testid={`factory-agent-${agent.key}`}
            >
              {agent.state === 'idle' && (
                <title>
                  {t('factory.idleDuration', {
                    duration: Math.round(idleMsOf(agent, nowMs) / 1000),
                  })}
                </title>
              )}
              <circle
                r={AGENT_RADIUS}
                fill={colours.fill}
                stroke={selected ? 'var(--w-focus)' : colours.stroke}
                strokeWidth={selected ? 3 : 1.5}
              />
              <text
                y={3}
                textAnchor="middle"
                fontSize="9"
                fontWeight={600}
                fill={colours.ink}
                pointerEvents="none"
              >
                {t(markerRoleKey(agent.role))}
              </text>
            </g>
          );
        })}
        {agents.map((agent, index) => {
          const position = markerPosition(agent, index, agents);
          if (!showsNeedsYou(agent, index, agents) || position.stationKey === null) {
            return null;
          }
          const centerX = px(stationCenter(position.stationKey));
          return (
            <g
              key={`needs-you-${position.stationKey}`}
              transform={`translate(${centerX}, ${position.y})`}
              pointerEvents="none"
            >
              <text
                x={0}
                y={-AGENT_RADIUS - 6}
                textAnchor="middle"
                fontSize="11"
                fontWeight={600}
                fill="var(--w-attention)"
                data-testid="factory-needs-you"
              >
                {t('factory.needsYou')}
              </text>
            </g>
          );
        })}
        {idleCaptionAgent !== undefined && (
          <g pointerEvents="none">
            <text
              x={px(BREAK_AREA.x + BREAK_AREA.width / 2)}
              y={BREAK_BOX_TOP + 14}
              textAnchor="middle"
              fontSize="10"
              fill="var(--w-text-muted)"
              data-testid="factory-idle-caption"
            >
              {t('factory.idleDuration', {
                duration: Math.round(idleMsOf(idleCaptionAgent, nowMs) / 1000),
              })}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
};
