import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AudioMeter } from '../components/AudioMeter';

describe('AudioMeter Component (AC-006, AC-014)', () => {
  it('renders with volume percentage and role meter', () => {
    render(<AudioMeter level={45} />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '45');
    expect(screen.getByText('45%')).toBeInTheDocument();
  });

  it('renders muted label when isMuted is true', () => {
    render(<AudioMeter level={70} isMuted={true} />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('Muted')).toBeInTheDocument();
  });
});