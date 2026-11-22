// apps/desktop/src/v3/pages/bench/components/BenchRecoveryCard.tsx
import { useT } from '@warsha/i18n/v3';
import { Button, IconAlert, Select, type SelectOption } from '@warsha/ui/v3';
import React, { useState } from 'react';

export interface BenchRecoveryCardProps {
  onRetry?: (model: string, engine: string) => void | Promise<void>;
  isRetrying?: boolean;
  defaultModel?: string;
  defaultEngine?: string;
}

export const BenchRecoveryCard: React.FC<BenchRecoveryCardProps> = ({
  onRetry,
  isRetrying = false,
  defaultModel = '9router',
  defaultEngine = 'opencode',
}) => {
  const t = useT();
  const [selectedModel, setSelectedModel] = useState(defaultModel);
  const [selectedEngine, setSelectedEngine] = useState(defaultEngine);

  const modelOptions: SelectOption[] = [
    { value: '9router', label: '9Router' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'orchesterar', label: 'Orchesterar' },
  ];

  const engineOptions: SelectOption[] = [
    { value: 'opencode', label: 'opencode' },
    { value: 'native', label: t('bench.recovery.engine_native') },
  ];

  const handleRetry = () => {
    onRetry?.(selectedModel, selectedEngine);
  };

  return (
    <section
      aria-label={t('bench.recovery.title')}
      data-testid="bench-recovery-card"
      style={{
        border: 'var(--w-border-width) solid var(--w-danger-border, var(--w-line-strong))',
        borderRadius: 'var(--w-radius-lg)',
        padding: 'var(--w-space-4)',
        backgroundColor: 'var(--w-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-3)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w-space-2)' }}>
        <IconAlert size={20} />
        <div>
          <h4
            style={{
              margin: 0,
              fontSize: 'var(--w-font-size-md)',
              fontWeight: 'var(--w-font-weight-semibold)',
              color: 'var(--w-text)',
            }}
          >
            {t('bench.recovery.title')}
          </h4>
          <p
            style={{
              margin: 'var(--w-space-1) 0 0',
              fontSize: 'var(--w-font-size-sm)',
              color: 'var(--w-text-muted)',
            }}
          >
            {t('bench.recovery.description')}
          </p>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 'var(--w-space-3)',
          marginBlockStart: 'var(--w-space-2)',
        }}
      >
        <Select
          label={t('bench.recovery.model_label')}
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          options={modelOptions}
          data-testid="bench-recovery-model-select"
        />
        <Select
          label={t('bench.recovery.engine_label')}
          value={selectedEngine}
          onChange={(e) => setSelectedEngine(e.target.value)}
          options={engineOptions}
          data-testid="bench-recovery-engine-select"
        />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginBlockStart: 'var(--w-space-2)',
        }}
      >
        <Button
          variant="primary"
          loading={isRetrying}
          onClick={handleRetry}
          data-action="bench.recovery.retry"
          data-testid="bench-recovery-retry-btn"
        >
          {isRetrying ? t('bench.recovery.retrying') : t('bench.recovery.retry_button')}
        </Button>
      </div>
    </section>
  );
};
