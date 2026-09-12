import { memo } from 'react';

export const PromptActivityBorder = memo(function PromptActivityBorder() {
  return <span aria-hidden="true" className="prompt-activity-border"><span className="prompt-activity-glow" /></span>;
});
