import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PromptInputSubmit } from './prompt-input';

describe('PromptInputSubmit', () => {
  it('keeps the submit icon after chat errors', () => {
    render(<PromptInputSubmit status="error" />);

    const icon = screen.getByRole('button', { name: '提交' }).querySelector('svg');

    expect(icon).toHaveClass('lucide-corner-down-left');
    expect(icon).not.toHaveClass('lucide-x');
  });
});
