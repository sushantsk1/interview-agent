import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SilenceIndicator } from '../components/SilenceIndicator';

describe('SilenceIndicator Component (AC-012)', () => {
  it('does not render when silence is below threshold (e.g. <= 0.3s)', () => {
    const { container } = render(<SilenceIndicator silenceSeconds={0.2} thresholdSeconds={2.75} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders countdown when sustained silence is ticking', () => {
    render(<SilenceIndicator silenceSeconds={1.5} thresholdSeconds={2.75} />);
    expect(screen.getByText(/Pause detected - finalizing answer in/i)).toBeInTheDocument();
    expect(screen.getByText('1.3s')).toBeInTheDocument();
  });
});