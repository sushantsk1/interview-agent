import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AIAvatar } from '../components/AIAvatar';

describe('AIAvatar Component (AC-009)', () => {
  it('renders speaking state with appropriate label', () => {
    render(<AIAvatar state="speaking" />);
    expect(screen.getByText('Speaking')).toBeInTheDocument();
  });

  it('renders listening state with appropriate label', () => {
    render(<AIAvatar state="listening" />);
    expect(screen.getByText('Listening')).toBeInTheDocument();
  });

  it('renders thinking state with appropriate label', () => {
    render(<AIAvatar state="thinking" />);
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  it('renders idle standby state by default', () => {
    render(<AIAvatar state="idle" />);
    expect(screen.getByText('Standby')).toBeInTheDocument();
  });

  it('renders completed state', () => {
    render(<AIAvatar state="completed" />);
    expect(screen.getByText('Finished')).toBeInTheDocument();
  });
});