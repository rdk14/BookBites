import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

test('renders upload screen with BookBites branding', () => {
  render(<App />);
  expect(screen.getByText(/BookBites AI/i)).toBeInTheDocument();
});

test('renders upload screen drop zone', () => {
  render(<App />);
  expect(screen.getByText(/Drop your PDF here/i)).toBeInTheDocument();
});

describe('Google Sheets cache check', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.REACT_APP_SHEETS_URL;
  });

  test('shows "Checking for existing cards in Google Sheets" progress label when processing a PDF', async () => {
    process.env.REACT_APP_SHEETS_URL = 'https://example.com/sheets';

    // Sheets returns no existing data (empty cards array)
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ cards: [] }),
    });

    // Stub PDF.js so extractPdfText doesn't fail
    window.pdfjsLib = {
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: () => Promise.resolve({
            getTextContent: () => Promise.resolve({ items: [{ str: 'hello' }] }),
          }),
        }),
      }),
      GlobalWorkerOptions: {},
    };

    // Mock all subsequent fetch calls (Claude API, etc.) to avoid real network requests
    global.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'mocked' } }),
    });

    render(<App />);

    const file = new File(['%PDF-dummy'], 'mybook.pdf', { type: 'application/pdf' });
    const input = screen.getByTestId('file-input');
    await userEvent.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText(/Checking for existing cards in Google Sheets/i)).toBeInTheDocument();
    });
  });

  test('loads cards from Google Sheets when they already exist', async () => {
    process.env.REACT_APP_SHEETS_URL = 'https://example.com/sheets';

    const mockCards = [
      {
        id: 'ch0-card0',
        type: 'insight',
        headline: 'Test Headline',
        body: 'Test body.',
        detail: 'Test detail.',
        tag: 'test',
        chapter: 'Chapter 1',
        chapterIndex: 0,
        theme: { bg: '#000', accent: '#fff', text: '#ccc' },
      },
    ];

    // Sheets returns existing cards
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ cards: mockCards }),
    });

    render(<App />);

    const file = new File(['%PDF-dummy'], 'mybook.pdf', { type: 'application/pdf' });
    const input = screen.getByTestId('file-input');
    await userEvent.upload(input, file);

    // App should transition to reader with cards loaded from Google Sheets
    await waitFor(() => {
      expect(screen.getByText(/Test Headline/i)).toBeInTheDocument();
    });
  });

  test('sends both bookTitle and pdfFilename as query params when checking Google Sheets', async () => {
    process.env.REACT_APP_SHEETS_URL = 'https://example.com/sheets';

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ cards: [] }),
    });

    window.pdfjsLib = {
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: () => Promise.resolve({
            getTextContent: () => Promise.resolve({ items: [{ str: 'hello' }] }),
          }),
        }),
      }),
      GlobalWorkerOptions: {},
    };

    global.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'mocked' } }),
    });

    render(<App />);

    const file = new File(['%PDF-dummy'], 'My Book.pdf', { type: 'application/pdf' });
    const input = screen.getByTestId('file-input');
    await userEvent.upload(input, file);

    await waitFor(() => {
      const sheetsCall = global.fetch.mock.calls[0];
      const calledUrl = sheetsCall[0];
      expect(calledUrl).toContain('bookTitle=My%20Book');
      expect(calledUrl).toContain('pdfFilename=My%20Book.pdf');
    });
  });

  test('strips .pdf extension case-insensitively from book title', async () => {
    process.env.REACT_APP_SHEETS_URL = 'https://example.com/sheets';

    const mockCards = [
      {
        id: 'ch0-card0',
        type: 'insight',
        headline: 'Uppercase PDF Test',
        body: 'Test body.',
        detail: 'Test detail.',
        tag: 'test',
        chapter: 'Chapter 1',
        chapterIndex: 0,
        theme: { bg: '#000', accent: '#fff', text: '#ccc' },
      },
    ];

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ cards: mockCards }),
    });

    render(<App />);

    // File with uppercase .PDF extension
    const file = new File(['%PDF-dummy'], 'My Book.PDF', { type: 'application/pdf' });
    const input = screen.getByTestId('file-input');
    await userEvent.upload(input, file);

    await waitFor(() => {
      const sheetsCall = global.fetch.mock.calls[0];
      const calledUrl = sheetsCall[0];
      // bookTitle should have the .PDF extension stripped
      expect(calledUrl).toContain('bookTitle=My%20Book');
      expect(calledUrl).not.toContain('bookTitle=My%20Book.PDF');
    });

    // Cards should be loaded without AI
    await waitFor(() => {
      expect(screen.getByText(/Uppercase PDF Test/i)).toBeInTheDocument();
    });
  });

  test('does not call AI when cards are found in Google Sheets', async () => {
    process.env.REACT_APP_SHEETS_URL = 'https://example.com/sheets';

    const mockCards = [
      {
        id: 'ch0-card0',
        type: 'insight',
        headline: 'Cached Card',
        body: 'From cache.',
        detail: 'No AI used.',
        tag: 'cache',
        chapter: 'Chapter 1',
        chapterIndex: 0,
        theme: { bg: '#000', accent: '#fff', text: '#ccc' },
      },
    ];

    // Google Sheets returns cards
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ cards: mockCards }),
    });

    render(<App />);

    const file = new File(['%PDF-dummy'], 'cached-book.pdf', { type: 'application/pdf' });
    const input = screen.getByTestId('file-input');
    await userEvent.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText(/Cached Card/i)).toBeInTheDocument();
    });

    // Only one fetch call should have been made (the Google Sheets check), no Claude API calls
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('example.com/sheets');
  });
});
