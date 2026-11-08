import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TextFallbackModal } from '../components/TextFallbackModal';

describe('TextFallbackModal Component (AC-026)', () => {
  it('does not render when isOpen is false', () => {
    const { container } = render(
      <TextFallbackModal isOpen={false} onClose={vi.fn()} onSubmit={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('allows candidate to type and submit typed answer', () => {
    const handleSubmit = vi.fn();
    const handleClose = vi.fn();

    render(
      <TextFallbackModal isOpen={true} onClose={handleClose} onSubmit={handleSubmit} />
    );

    const textarea = screen.getByPlaceholderText(/Type your response to the current interview question/i);
    fireEvent.change(textarea, { target: { value: 'My typed response for FastAPI async.' } });

    const submitBtn = screen.getByRole('button', { name: /Submit Typed Answer/i });
    fireEvent.click(submitBtn);

    expect(handleSubmit).toHaveBeenCalledWith('My typed response for FastAPI async.');
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});