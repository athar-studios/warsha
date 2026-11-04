// @warsha/ui — the Bench & Signal compound inventory (docs/design/REDESIGN.md §6).
//
// One file per family, so `Ledger` and `Ledger.Row` are read and reviewed together; this barrel is the
// only thing `src/index.ts` needs to know about them. Nothing here is a re-export of a catalog string: the
// compounds take their words from props or children, which is what keeps `@warsha/ui` usable from the
// desktop, the remote PWA and a story alike.

export * from './Banner';
export * from './Chip';
export * from './Composer';
export * from './DiffView';
export * from './EmptyState';
export * from './Field';
export * from './GateCard';
export * from './Lamp';
export * from './Ledger';
export * from './Meter';
export * from './ModeSwitch';
export * from './Panel';
export * from './RailRow';
export * from './Segmented';
export * from './Skeleton';
export * from './Stamp';
export * from './StatusStrip';
export * from './Stream';
export * from './Tabs';
export * from './TerminalDock';

// The machine rule. A screen that builds its own inline data span — the phone's `Machine`, the desktop's
// run-id line — must resolve the same face for the same word the compounds do, so the decision in
// `internal.ts` is exported rather than copied. These are helpers and token objects, not components: no
// story is owed for them, and the compounds keep the only copy of the rule.
export {
  carriesJoinedScript,
  MACHINE,
  MACHINE_SMALL,
  machineSkin,
  machineSkinSmall,
  slotText,
} from './internal';
