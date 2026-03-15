import { render, screen } from '@testing-library/react';
import App from './App';

test('renders upload screen with BookBites branding', () => {
  render(<App />);
  expect(screen.getByText(/BookBites AI/i)).toBeInTheDocument();
});

test('renders upload screen drop zone', () => {
  render(<App />);
  expect(screen.getByText(/Drop your PDF here/i)).toBeInTheDocument();
});
