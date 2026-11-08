import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CandidateWebcam } from '../components/CandidateWebcam';

describe('CandidateWebcam Component (AC-006, AC-008, AC-014)', () => {
  it('renders candidate name badge', () => {
    render(
      <CandidateWebcam
        stream={null}
        candidateName="Jane Doe"
        isMuted={false}
        isVideoOff={false}
      />
    );
    expect(screen.getByText(/Jane Doe \(You\)/i)).toBeInTheDocument();
  });

  it('renders muted status when muted', () => {
    render(
      <CandidateWebcam
        stream={null}
        candidateName="Jane Doe"
        isMuted={true}
        isVideoOff={false}
      />
    );
    expect(screen.getAllByText('Muted').length).toBeGreaterThan(0);
  });

  it('calls onToggleMute and onToggleVideo when buttons clicked', () => {
    const handleToggleMute = vi.fn();
    const handleToggleVideo = vi.fn();

    render(
      <CandidateWebcam
        stream={null}
        candidateName="Jane Doe"
        isMuted={false}
        isVideoOff={false}
        onToggleMute={handleToggleMute}
        onToggleVideo={handleToggleVideo}
        showControls={true}
      />
    );

    const muteBtn = screen.getByTitle('Mute microphone');
    fireEvent.click(muteBtn);
    expect(handleToggleMute).toHaveBeenCalledTimes(1);

    const videoBtn = screen.getByTitle('Turn off camera');
    fireEvent.click(videoBtn);
    expect(handleToggleVideo).toHaveBeenCalledTimes(1);
  });
});