// Web deploy button — one-button deploy of the built web artifact (PLAN.md M5a).
// The button only reports intent: `onDeploy` is the seam the daemon's deploy
// call plugs into, and `status` is what the caller observes. Provider and
// credentials stay in the keychain; nothing here reads or logs a secret.
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import { Button } from '@warsha/ui';

export type DeployStatus = 'idle' | 'deploying' | 'done' | 'error';

const labels: Record<DeployStatus, Record<Locale, string>> = {
  idle: { ar: 'نشر إلى الويب', en: 'Deploy to web' },
  deploying: { ar: 'جاري النشر…', en: 'Deploying…' },
  done: { ar: 'تم النشر', en: 'Deployed' },
  error: { ar: 'فشل النشر', en: 'Deploy failed' },
};

const descriptions: Record<DeployStatus, Record<Locale, string>> = {
  idle: {
    ar: 'جاهز لنشر نسخة الويب المبنية إلى الهدف المضبوط',
    en: 'Ready to deploy the built web artifact to the configured target',
  },
  deploying: {
    ar: 'النشر جارٍ الآن، لا تغلق النافذة',
    en: 'Deploying now; do not close the window',
  },
  done: {
    ar: 'تم النشر. انشر علنًا من بوابة الإصدار عندما تريد',
    en: 'Deployed. Publish publicly from the release gate when you are ready',
  },
  error: {
    ar: 'فشل النشر. تحقّق من بيانات الاعتماد والهدف',
    en: 'Deploy failed. Check the credentials and the target',
  },
};

const blockedHint = {
  ar: 'لا يمكن النشر حتى ينجح فحص ما قبل الإصدار',
  en: 'Deploy stays off until the release preflight is green',
};

const icons: Record<DeployStatus, string> = { idle: '↑', deploying: '', done: '✓', error: '✗' };

const statusColors: Record<DeployStatus, string> = {
  idle: '#6b7280',
  deploying: '#1e40af',
  done: '#166534',
  error: '#991b1b',
};

/**
 * Translate a key, falling back to the local label when the catalog has no
 * entry yet (`t` returns the key itself for a missing message).
 */
function localized(key: string, fallback: string, locale: Locale): string {
  const translated = t(key, {}, locale);
  return translated === key ? fallback : translated;
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

  // A second click while deploying would queue a second deploy, so the busy
  // state disables the button on top of what the caller asked for.
  const busy = status === 'deploying';
  const isDisabled = disabled || busy;
  const label = localized(`status_strip.deploy.${status}`, labels[status][locale], locale);
  const description = localized(
    `status_strip.deploy.description.${status}`,
    descriptions[status][locale],
    locale
  );
  const hint = localized('status_strip.deploy.blocked', blockedHint[locale], locale);

  return (
    <div
      dir={dir}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}
    >
      <span title={disabled ? hint : description}>
        <Button
          variant={status === 'done' ? 'secondary' : 'primary'}
          size="sm"
          dir={dir}
          data-testid="web-deploy-button"
          data-status={status}
          disabled={isDisabled}
          title={isDisabled ? hint : description}
          aria-label={`${label} — ${description}`}
          style={{ opacity: isDisabled ? 0.6 : 1 }}
          onClick={busy ? undefined : onDeploy}
        >
          {busy ? (
            // SVG + SMIL: the spin lives in the markup, not in a stylesheet.
            <svg
              data-testid="web-deploy-spinner"
              aria-hidden="true"
              width="10"
              height="10"
              viewBox="0 0 10 10"
              style={{ display: 'inline-block', flex: '0 0 auto' }}
            >
              <circle
                cx="5"
                cy="5"
                r="4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="8 17"
                strokeLinecap="round"
              />
              <animateTransform
                attributeName="transform"
                attributeType="XML"
                type="rotate"
                from="0 5 5"
                to="360 5 5"
                dur="0.9s"
                repeatCount="indefinite"
              />
            </svg>
          ) : (
            <span aria-hidden="true">{icons[status]}</span>
          )}
          <span>{label}</span>
        </Button>
      </span>
      <span
        data-testid="web-deploy-status"
        role="status"
        aria-live="polite"
        style={{ fontSize: '0.75rem', color: statusColors[status] }}
      >
        {description}
      </span>
    </div>
  );
}
