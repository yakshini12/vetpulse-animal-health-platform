import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Badge, ErrorAlert, Modal } from '../components/ui.js';
import { ApiError } from '../api/client.js';

describe('shared UI rules', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders enum values as humanised badges (IN_PROGRESS shows as "In progress")', () => {
    render(<Badge value="IN_PROGRESS" />);
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });

  it('colours terminal sample states differently from pipeline states', () => {
    const first = render(<Badge value="COMPLETED" />);
    const second = render(<Badge value="REJECTED" />);
    const doneText = first.getByText('Completed');
    const rejectedText = second.getByText('Rejected');
    expect(doneText.className).not.toBe(rejectedText.className); // different colour tokens
    expect(doneText.className).toContain('good');
    expect(rejectedText.className).toContain('bad');
  });

  it('shows the error envelope message and code for rejected transitions', () => {
    render(
      <ErrorAlert
        error={new ApiError(409, 'INVALID_TRANSITION', 'Cannot move a sample from RECEIVED to COMPLETED.')}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(/Cannot move a sample from RECEIVED to COMPLETED\./)).toBeInTheDocument();
    expect(within(alert).getByText(/INVALID_TRANSITION/)).toBeInTheDocument();
  });

  it('modal only mounts its content while open', () => {
    const { rerender } = render(
      <MemoryRouter>
        <Modal title="Reject sample" open={false} onClose={() => {}}>
          Body content
        </Modal>
      </MemoryRouter>,
    );
    expect(screen.queryByText('Reject sample')).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <Modal title="Reject sample" open onClose={() => {}}>
          Body content
        </Modal>
      </MemoryRouter>,
    );
    expect(screen.getByRole('dialog', { name: 'Reject sample' })).toBeInTheDocument();
  });
});
