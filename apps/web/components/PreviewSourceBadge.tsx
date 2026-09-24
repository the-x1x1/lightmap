import { SOURCE_MODE_DESCRIPTION, SOURCE_MODE_LABEL, type SourceMode } from '@lightmap/scene';
import { Badge } from '@lightmap/ui';

const TONE: Record<SourceMode, 'ok' | 'sun' | 'twilight'> = {
  REAL_REFERENCE: 'ok',
  SIMULATED_LIGHTING: 'sun',
  ESTIMATED_PREVIEW: 'twilight',
};
const ICON: Record<SourceMode, string> = {
  REAL_REFERENCE: '▣',
  SIMULATED_LIGHTING: '◆',
  ESTIMATED_PREVIEW: '◇',
};

/** Every preview carries one of the three source states (plan §2). Shape + text, not colour alone. */
export function PreviewSourceBadge({ mode }: { mode: SourceMode }) {
  return (
    <Badge
      tone={TONE[mode]}
      icon={ICON[mode]}
      title={SOURCE_MODE_DESCRIPTION[mode]}
      data-testid="source-badge"
    >
      <span data-testid="source-mode" data-value={mode}>
        {SOURCE_MODE_LABEL[mode]}
      </span>
    </Badge>
  );
}
