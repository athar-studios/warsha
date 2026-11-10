import type { HarnessDefinition, RunModeConfig } from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
// eslint-disable-next-line import/no-unresolved
import { Button, Card, IconButton, IconCheck, IconSend, Select, TextArea, TextField } from '@warsha/ui/v3';
import React, { useEffect, useState } from 'react';

import { useCapabilities } from '../../../app/CapabilitiesContext';

export interface AdvancedComposerProps {
  harnesses: HarnessDefinition[];
  runModes: RunModeConfig[];
  budgetUsd: number;
  onSendFollowup: (prompt: string) => Promise<void> | void;
  followupPending?: boolean;
  onSelectHarness: (harnessId: string) => Promise<void> | void;
  harnessPending?: boolean;
  onSetRunMode: (config: RunModeConfig) => Promise<void> | void;
  runModePending?: boolean;
  onSaveBudget: (cents: number) => Promise<void> | void;
  budgetPending?: boolean;
}

export const AdvancedComposer: React.FC<AdvancedComposerProps> = ({
  harnesses,
  runModes,
  budgetUsd,
  onSendFollowup,
  followupPending = false,
  onSelectHarness,
  harnessPending = false,
  onSetRunMode,
  runModePending = false,
  onSaveBudget,
  budgetPending = false,
}) => {
  const t = useT();
  const capabilities = useCapabilities();

  const [prompt, setPrompt] = useState('');
  const [selectedHarness, setSelectedHarness] = useState('');
  const [selectedRunMode, setSelectedRunMode] = useState('');
  const [budgetInput, setBudgetInput] = useState(String(budgetUsd || ''));

  useEffect(() => {
    const active = harnesses.find((h) => h.active);
    if (active) {
      setSelectedHarness(active.id);
    } else if (harnesses.length > 0 && !selectedHarness) {
      setSelectedHarness(harnesses[0].id);
    }
  }, [harnesses, selectedHarness]);

  useEffect(() => {
    if (runModes.length > 0 && !selectedRunMode) {
      setSelectedRunMode(runModes[0].mode);
    }
  }, [runModes, selectedRunMode]);

  useEffect(() => {
    setBudgetInput(budgetUsd > 0 ? String(budgetUsd) : '');
  }, [budgetUsd]);

  const handleSubmit = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    await onSendFollowup(trimmed);
    setPrompt('');
  };

  const handleHarnessApply = async (val?: string) => {
    const target = val ?? selectedHarness;
    if (target) {
      await onSelectHarness(target);
    }
  };

  const handleRunModeApply = async (val?: string) => {
    const target = val ?? selectedRunMode;
    const found = runModes.find((m) => m.mode === target);
    if (found) {
      await onSetRunMode(found);
    }
  };

  const handleBudgetSave = async () => {
    const parsed = Number(budgetInput);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    await onSaveBudget(Math.round(parsed * 100));
  };

  const harnessOptions =
    harnesses.length > 0
      ? harnesses.map((h) => ({ value: h.id, label: h.name || h.id }))
      : [{ value: '', label: t('bench.composer.no_harnesses'), disabled: true }];

  const runModeOptions =
    runModes.length > 0
      ? runModes.map((m) => ({ value: m.mode, label: m.mode }))
      : [{ value: '', label: t('bench.composer.no_runmodes'), disabled: true }];

  return (
    <Card
      data-testid="bench-advanced-composer"
      style={{
        marginBlockStart: 'var(--w-space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-3)',
      }}
    >
      <TextArea
        label={t('bench.composer.label')}
        placeholder={t('bench.composer.placeholder')}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onEnter={() => void handleSubmit()}
        rows={3}
        data-testid="bench-composer-textarea"
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 'var(--w-space-3)',
          flexWrap: 'wrap',
        }}
      >
        {capabilities.harnesses && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--w-space-1)' }}>
            <Select
              label={t('bench.composer.harness')}
              options={harnessOptions}
              value={selectedHarness}
              disabled={harnessPending || harnesses.length === 0}
              onChange={(e) => {
                setSelectedHarness(e.target.value);
                void handleHarnessApply(e.target.value);
              }}
              data-testid="bench-harness-select"
            />
            <IconButton
              icon={<IconCheck size={14} />}
              label={t('bench.action.harness_select')}
              variant="ghost"
              size="sm"
              disabled={harnessPending || !selectedHarness}
              onClick={() => void handleHarnessApply()}
              data-action="bench.harness.select"
              data-testid="bench-harness-apply-btn"
            />
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--w-space-1)' }}>
          <Select
            label={t('bench.composer.runmode')}
            options={runModeOptions}
            value={selectedRunMode}
            disabled={runModePending || runModes.length === 0}
            onChange={(e) => {
              setSelectedRunMode(e.target.value);
              void handleRunModeApply(e.target.value);
            }}
            data-testid="bench-runmode-select"
          />
          <IconButton
            icon={<IconCheck size={14} />}
            label={t('bench.action.runmode_set')}
            variant="ghost"
            size="sm"
            disabled={runModePending || !selectedRunMode}
            onClick={() => void handleRunModeApply()}
            data-action="bench.runmode.set"
            data-testid="bench-runmode-apply-btn"
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--w-space-2)' }}>
          <TextField
            label={t('bench.cost.budget_label')}
            type="number"
            min="0"
            step="any"
            prefix="$"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            data-testid="bench-composer-budget-input"
          />
          <Button
            variant="ghost"
            size="sm"
            loading={budgetPending}
            onClick={() => void handleBudgetSave()}
            data-action="bench.budget.save"
            data-testid="bench-composer-budget-save-btn"
          >
            {t('bench.cost.save_budget')}
          </Button>
        </div>

        <div style={{ marginInlineStart: 'auto' }}>
          <Button
            variant="secondary"
            size="sm"
            iconEnd={<IconSend size={14} />}
            loading={followupPending}
            disabled={!prompt.trim() || followupPending}
            onClick={() => void handleSubmit()}
            data-action="bench.followup.send"
            data-testid="bench-followup-send-btn"
          >
            {t('bench.composer.send')}
          </Button>
        </div>
      </div>
    </Card>
  );
};

AdvancedComposer.displayName = 'AdvancedComposer';
