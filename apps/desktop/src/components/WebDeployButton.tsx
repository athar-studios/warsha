// Web deploy button — one-button deploy of the built web artifact (PLAN.md M5a), redrawn for the bench.
//
// The button only reports intent: `onDeploy` is the seam the daemon's deploy call plugs into, and `status`
// is what the caller observes. Provider and credentials stay in the keychain; nothing here reads or logs a
// secret.
//
// The bench reading (§7, §8, §9): success is quiet — a lamp, a word and the mono target — and a busy deploy
// says so with `aria-busy` plus the working lamp's own breathe, which `tokens.css` already stops under
// `prefers-reduced-motion`. There is no spinner to animate and no colour-only signal: the status line
// beside the button repeats the state in words inside a `role="status"` region, so the owner is told, not
// shown. Every word is `@warsha/i18n` (`status_strip.deploy.*`).
import { t, useDirection, useLocale } from '@warsha/i18n';
import { Button, Lamp, type LampState } from '@warsha/ui';

export type DeployStatus = 'idle' | 'deploying' | 'done' | 'error';

/** The lamp a deploy status lights. `idle` is deliberately quiet (§1). */
export function deployLamp(status: DeployStatus): LampState {
  switch (status) {
    case 'deploying':
      return 'working';
    case 'done':
      return 'ok';
    case 'error':
      return 'fail';
    case 'idle':
      return 'idle';
  }
}

export interface WebDeployButtonProps {
  /** True when the deploy must stay off (for example, the preflight is not green). */
  disabled: boolean;
  /** Called when the owner asks for a deploy. Ignored while deploying. */
  onDeploy: () => void;
  /** What the caller knows about the last deploy attempt. */
  status: DeployStatus;
}

export function WebDeployButton({ disabled, onDeploy, status }: WebDeployButtonProps) {
  const dir = useDirection();
  const locale = useLocale();

  // A second click while deploying would queue a second deploy, so the busy state disables the button on
  // top of what the caller asked for.
  const busy = status === 'deploying';
  const isDisabled = disabled || busy;
  const label = t(`status_strip.deploy.${status}`, {}, locale);
  const description = t(`status_strip.deploy.description.${status}`, {}, locale);
  const hint = t('status_strip.deploy.blocked', {}, locale);

  return (
    <div
      dir={dir}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--warsha-space-3)',
        flexWrap: 'wrap',
        minInlineSize: 0,
      }}
    >
      <Button
        variant={status === 'done' ? 'secondary' : 'primary'}
        size="sm"
        dir={dir}
        data-testid="web-deploy-button"
        data-status={status}
        disabled={isDisabled}
        aria-busy={busy}
        title={isDisabled ? hint : description}
        aria-label={`${label} — ${description}`}
        // A disabled control tells the owner nothing on its own (§7): the tooltip names the gate, and the
        // status line below repeats it in the a11y tree.
        style={{ minBlockSize: 'var(--warsha-size-touch)', opacity: isDisabled ? 0.6 : 1 }}
        onClick={busy ? undefined : onDeploy}
      >
        {label}
      </Button>

      {/* The status line *is* the live region: one announcement per change, in words, beside the control
          it describes (§9). */}
      <span
        data-testid="web-deploy-status"
        role="status"
        aria-live="polite"
        style={{ minInlineSize: 0 }}
      >
        <Lamp state={deployLamp(status)} size="xs">
          {isDisabled ? hint : description}
        </Lamp>
      </span>
    </div>
  );
}
